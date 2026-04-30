# LiveSlot — Architecture & Code Walkthrough

## What Is It?

LiveSlot is a two-page web app where you:

1. Upload an ad creative (image, GIF, video, or HTML5 ZIP) and enter a website URL.
2. A headless browser loads the page, detects every ad slot, and takes a full-page JPEG screenshot.
3. Click any detected slot to see your creative composited pixel-accurately over the live page screenshot.

---

## High-Level Data Flow

```
User uploads file          → POST /api/upload
                           → Saves to /tmp/{fileId}.{ext}
                           → Returns UploadResult (fileId, dims, mimeType, tempUrl)

User clicks "Detect"       → POST /api/detect-slots
                           → Puppeteer launches Chrome, navigates to URL
                           → Detects slots via CSS selectors + IAB dimension scan
                           → Captures full-page JPEG screenshot (q85)
                           → Returns DetectionResult (slots[], screenshot, dims)

User clicks a slot         → PreviewPanel opens

  [Effect — always]        → Client fetches creative from GET /api/serve/{fileId}
                           → Converts blob → base64 via FileReader
                           → Caches in creativeBase64Ref { fileId, b64 }
                           → Sets creativeReady = true

  [OverlayView]            → Renders screenshot <img> as base layer
                           → ResizeObserver computes scale = img.clientWidth / img.naturalWidth
                           → Overlays creative at (slot.x * scale, slot.y * scale)
                           → No server round-trip — fully client-side, pixel-accurate
```

---

## Directory Structure

```
app/
  page.tsx                      ← Page 1: creative upload + URL input
  results/page.tsx              ← Page 2: slot grid + preview panel
  layout.tsx                    ← Fonts (Instrument Serif, IBM Plex Mono, IBM Plex Sans), metadata
  globals.css                   ← CSS variables, Tailwind base, animations (panel-open, scan-line)
  api/
    upload/route.ts             ← Validates + saves creative to /tmp, returns UploadResult
    detect-slots/route.ts       ← Runs Puppeteer, returns DetectionResult (maxDuration=60)
    serve/[fileId]/route.ts     ← Reads file from /tmp, returns raw bytes with Content-Type
    cleanup/route.ts            ← Deletes file from /tmp (DELETE method)

lib/
  chromium.ts                   ← Static re-export of @sparticuz/chromium + CHROMIUM_REMOTE_URL
  detectSlots.ts                ← All Puppeteer logic: launch, navigate, detect, screenshot
  adSelectors.ts                ← IAB_SIZES (19), AD_SELECTORS (~40), getIabName(), isIabSize()
  screenshotOverlay.ts          ← getImageDimensions() via Sharp (used by upload route)
  fileManager.ts                ← /tmp read/write/delete helpers (getTmpDir, writeTmpFile, etc.)

components/
  PreviewPanel.tsx              ← Full-screen slide-in: OverlayView composites creative on screenshot
  SlotGrid.tsx                  ← Grid of detected slot cards
  LoadingSkeleton.tsx           ← ScanningState animation + SlotGridSkeleton placeholder cards

types/index.ts                  ← All shared TypeScript interfaces (AdSlot, DetectionResult, etc.)
next.config.ts                  ← serverExternalPackages + webpack externals for puppeteer/sharp/chromium
```

---

## Page 1 — `app/page.tsx`

Fully client-side (`'use client'`).

**What it does:**

- Two-column form: left = creative upload, right = URL input + submit.
- Validates MIME type and 50 MB limit in the browser _before_ hitting the server.
- On file select → `POST /api/upload` → stores the returned `UploadResult` as a `Creative` in state.
- On submit → saves all creative metadata to `sessionStorage` (so navigating back restores the form) → pushes to `/results?fileId=xxx&url=https://...`.
- `useEffect` on mount reads `sessionStorage` to pre-fill both the URL and the creative thumbnail on return.

**MIME allowlist (client + server both validate):**
`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`, `application/zip`, `application/x-zip-compressed`

**Why sessionStorage?** The file bytes live in `/tmp` on a server function instance. Metadata lives in sessionStorage so the results page can restore the `Creative` object without another network round-trip.

---

## Page 2 — `app/results/page.tsx`

Fully client-side (`'use client'`). Wrapped in `<Suspense>` because `useSearchParams()` requires a suspense boundary in the App Router.

**What it does:**

1. Reads `fileId` and `url` from URL search params.
2. Restores `Creative` metadata from `sessionStorage` (sets `tempUrl` to `/api/serve/{fileId}`).
3. On mount → `POST /api/detect-slots` with `{ url }`. The server does all Puppeteer work and returns a full `DetectionResult`.
4. Shows `<ScanningState>` + `<SlotGridSkeleton>` while scanning, then `<SlotGrid>` with results, or an error panel.
5. On slot click → `setSelectedSlot(slot)` + `setIsPanelOpen(true)` → `<PreviewPanel>` opens.

**Step states:** `scanning` → `results` | `error`. Retry re-runs the detect-slots fetch.

---

## API Route: `POST /api/upload`

**File:** `app/api/upload/route.ts`

1. Reads `multipart/form-data` body via `request.formData()`.
2. Validates MIME type against `ALLOWED_TYPES` and enforces 50 MB max.
3. Generates a UUID (`fileId`) via `uuid`.
4. Writes the file to `/tmp/{fileId}.{ext}` via `lib/fileManager.writeTmpFile()`.
5. For `image` and `gif` types, calls `getImageDimensions(buffer)` from `lib/screenshotOverlay.ts` (uses Sharp) to get pixel dimensions.
6. Returns an `UploadResult` JSON: `{ fileId, fileName, fileType, mimeType, width, height, tempUrl: "/api/serve/{fileId}", size }`.

Videos and ZIPs return `width: 0, height: 0` — dimensions are not required for them.

---

## API Route: `POST /api/detect-slots`

**File:** `app/api/detect-slots/route.ts`

`export const maxDuration = 60` — extends Vercel timeout to 60s (Puppeteer cold start needs ~15–25s).

1. Validates URL: must parse as a valid `URL`, must be `http:` or `https:`.
2. **SSRF protection** (production only, guarded by `process.env.VERCEL`): blocks `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, and RFC-1918 private IP ranges.
3. Calls `detectAdSlots(url)` from `lib/detectSlots.ts`.
4. Wraps result in a `DetectionResult` (adds `url` and `detectedAt: new Date().toISOString()`).
5. Returns the full `DetectionResult` JSON.

---

## API Route: `GET /api/serve/[fileId]`

**File:** `app/api/serve/[fileId]/route.ts`

- Validates `fileId` is a UUID v4 (regex: `/^[0-9a-f]{8}-...-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-...$`). Rejects anything else with 400 — prevents path traversal.
- Calls `fileManager.readTmpFile(fileId)` — scans `/tmp` for any file matching `{fileId}.*`.
- Returns raw bytes as `new Uint8Array(buffer)` with `Content-Type` derived from the file extension.
- `Cache-Control: private, max-age=3600`.

**Why it exists:** The browser needs a real URL to display the creative thumbnail and to download the file for base64 encoding. This route bridges the server's `/tmp` filesystem to the browser.

---

## API Route: `DELETE /api/cleanup`

**File:** `app/api/cleanup/route.ts`

- Reads `{ fileId }` from JSON body.
- Validates UUID format.
- Calls `fileManager.deleteTmpFile(fileId)`.
- Returns `{ success: boolean, fileId }`.
- Called from `app/page.tsx` when the user removes a creative (the × button).

---

## `lib/fileManager.ts`

Thin wrapper around Node's `fs` module for `/tmp` operations.

| Export | Behaviour |
|---|---|
| `getTmpDir()` | Returns `/tmp` on Vercel, `os.tmpdir()` locally |
| `getTmpFilePath(fileId, ext)` | Returns `{TMP_DIR}/{fileId}.{ext}` (does not scan) |
| `getTmpFilePathById(fileId)` | Scans `/tmp` for any file starting with `fileId`, returns full path or null |
| `getExtFromFileId(fileId)` | Same scan, returns extension without the `.`, or null |
| `writeTmpFile(fileId, ext, buffer)` | `fs.writeFileSync` to `{fileId}.{ext}` |
| `readTmpFile(fileId)` | `getTmpFilePathById` + `fs.readFileSync`, returns `Buffer` or null |
| `deleteTmpFile(fileId)` | `getTmpFilePathById` + `fs.unlinkSync`, returns `boolean` |
| `tmpFileExists(fileId)` | `getTmpFilePathById` + `fs.existsSync` |

**Why scan by prefix, not exact path?** The extension is not always known at read/delete time (e.g., the serve and cleanup routes only receive `fileId`). Scanning for `{fileId}.*` makes extension-agnostic access possible.

---

## `lib/chromium.ts`

```ts
import chromium from '@sparticuz/chromium';
export default chromium;
export const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar';
```

**Why a separate file?** Turbopack needs `serverExternalPackages` to prevent bundling `@sparticuz/chromium`. This only works if the package appears as a **static top-level `import`** in a file Turbopack can identify as external. Dynamic `import()` inside a function body is not recognised. This wrapper ensures the static import relationship is unambiguous.

**`CHROMIUM_REMOTE_URL`:** On Vercel, the bundled `bin/` directory (which normally contains the pre-extracted binary) is not included in the deployment. `chromium.executablePath(url)` checks `/tmp` for a cached binary; on cold start it downloads and extracts the tar from this GitHub Releases URL into `/tmp`, then returns the path to the `chromium` executable. First cold start adds ~15–25s to the detect-slots response.

---

## `lib/detectSlots.ts`

The core Puppeteer logic. Exported as a single function `detectAdSlots(url)`.

**Steps:**

1. **Launch**: On Vercel (`process.env.VERCEL`), uses `chromium.executablePath(CHROMIUM_REMOTE_URL)` and `chromium.args`. Locally, walks a list of known system Chrome paths (`/Applications/Google Chrome.app/...`, `/usr/bin/google-chrome`, Windows paths).

2. **Configure page**: Viewport `1440×900`, realistic macOS Chrome user agent.

3. **Navigate**: `page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })` + `setTimeout(2000)` extra wait for lazy-loaded ads.

4. **Measure page**: `document.documentElement.scrollWidth/scrollHeight` for true full-page dimensions. Sets viewport to `min(scrollWidth, 1440) × min(scrollHeight, 10000)` before screenshot.

5. **Detect slots** (`page.evaluate()` — runs inside the headless browser's JS context):
   - Iterates `AD_SELECTORS` and calls `querySelectorAll(selector)` for each.
   - Also scans all `div/aside/section` elements and checks if their `getBoundingClientRect()` dimensions match any `IAB_SIZES` within `IAB_SIZE_TOLERANCE = 10px`.
   - For each element: computes absolute `(x, y)` using `rect.left + scrollX`, deduplicates by a `"x_y_w_h"` string key.
   - Filters out elements smaller than `50×30px`.
   - Tracks `selectorIndex`: a `selectorCount: Record<string, number>` map increments each time a selector emits an element. Element `n` for a given selector gets `selectorIndex = n` (0-based). This is stored alongside the element so it can be located again later by the exact same `querySelectorAll(selector)[selectorIndex]` expression.
   - Checks visibility via `getComputedStyle` (`display !== 'none'`, `visibility !== 'hidden'`, `opacity !== '0'`).

6. **Screenshot**: `page.screenshot({ fullPage: true, type: 'jpeg', quality: 85 })`. JPEG at q85 is ~4× smaller than PNG, keeping the `detect-slots` response under Vercel's 4.5 MB response limit when combined with the `pageHTML` string.

7. **Capture HTML**: `page.content()` returns the fully-rendered post-JavaScript HTML — ad containers added by GAM, AdSense, Prebid etc. are present in the DOM.

8. **Build `AdSlot[]`**: each raw slot gets a UUID `id`, a human-readable `label` from `getIabName(w, h)`, and all detection metadata.

9. **Deduplicate** (`deduplicateSlots()`): for each new slot, computes the intersection-over-min-area ratio with every already-accepted slot. If `overlapRatio > 0.7`, keeps the one with a named CSS selector over `'iab-dimension-match'`; if both are named (or both dimension), keeps the larger area.

---

## `lib/adSelectors.ts`

**`IAB_SIZES`** — 19 standard sizes:

| Name | Dimensions |
|---|---|
| Leaderboard | 728×90 |
| Medium Rectangle | 300×250 |
| Mobile Banner | 320×50 |
| Large Mobile Banner | 320×100 |
| Wide Skyscraper | 160×600 |
| Half Page | 300×600 |
| Billboard | 970×250 |
| Super Leaderboard | 970×90 |
| Square | 250×250 |
| Small Square | 200×200 |
| Full Banner | 468×60 |
| Half Banner | 234×60 |
| Skyscraper | 120×600 |
| Vertical Banner | 120×240 |
| Large Rectangle | 336×280 |
| Netboard | 580×400 |
| Portrait | 300×1050 |
| Tablet Interstitial | 768×1024 |
| Smartphone Interstitial | 480×320 |

**`IAB_SIZE_TOLERANCE`** = `10` px. Matching allows ±10px in each dimension to handle sub-pixel rendering.

**`AD_SELECTORS`** (~40 selectors, categorised):
- **AdSense**: `ins.adsbygoogle`
- **Google Ad Manager**: `div[id^="div-gpt-ad"]`, `div[id*="gpt-ad"]`
- **Generic id patterns**: `div[id*="ad-slot"]`, `div[id*="-ad-"]`, `div[id^="ad-"]`, `div[id$="-ad"]`, and underscore variants
- **Generic class patterns**: `div[class*="ad-slot"]`, `div[class*="adunit"]`, `div[class*="advertisement"]`, `div[class*="dfp-ad"]`, etc.
- **Data attributes**: `[data-ad-slot]`, `[data-google-query-id]`, `[data-ad-unit]`, `[data-ad-id]`, `[data-adunit]`, `[data-dfp-ad]`
- **Ad network iframes**: `iframe[src*="doubleclick.net"]`, `iframe[src*="googlesyndication.com"]`, `iframe[src*="googletagservices.com"]`, `iframe[src*="amazon-adsystem.com"]`, `iframe[src*="moatads.com"]`, `iframe[src*="media.net"]`, `iframe[id*="google_ads_iframe"]`
- **Prebid/header bidding**: `div[id*="prebid"]`, `div[id*="hb-ad"]`
- **Common publisher naming**: `div[id*="leaderboard"]`, `div[id*="skyscraper"]`, `div[id*="rectangle"]`, `div[id*="mrec"]`, `div[id*="banner"]`, `div[class*="leaderboard"]`, `div[class*="skyscraper"]`

**`getIabName(w, h)`**: iterates `IAB_SIZES`, returns `size.name` if both dimensions are within tolerance, otherwise `"Custom {w}×{h}"`.

**`isIabSize(w, h)`**: returns `true` if any size matches within tolerance.

---

## `lib/screenshotOverlay.ts`

Minimal Sharp wrapper — the compositing functions were removed when the Screenshot API route was deleted.

**`getImageDimensions(buffer)`**: `sharp(buffer).metadata()` → `{ width, height }`. Used by the upload route to measure uploaded image/GIF dimensions.

---

## `components/PreviewPanel.tsx`

A full-screen overlay panel with a slide-in CSS animation (`panel-open` / `panel-close` classes from `globals.css`). Renders `null` when `isOpen = false`.

### State inventory

| State | Type | Purpose |
|---|---|---|
| `overlayError` | `string \| null` | Error from creative fetch |
| `isClosing` | `boolean` | Triggers close animation |
| `creativeReady` | `boolean` | True once the creative base64 has been fetched and cached |

### Refs

| Ref | Type | Purpose |
|---|---|---|
| `creativeBase64Ref` | `{ fileId, b64 } \| null` | Cached creative base64 — shared across slot changes |

### Effect — fetch + cache creative base64

**Dependency:** `[isOpen, creative?.fileId]`

- Guard: if `creativeBase64Ref.current?.fileId === creative.fileId`, already have it → `setCreativeReady(true)` immediately, skip fetch.
- Otherwise: `setCreativeReady(false)` → `fetch(creative.tempUrl)` → `r.blob()` → `FileReader.readAsDataURL()` → extracts the base64 portion (`.split(',')[1]`).
- On success: stores `{ fileId: creative.fileId, b64 }` in `creativeBase64Ref.current`, sets `creativeReady = true`.
- **Why keyed on `isOpen`?** On Vercel, the instance that served the upload may not be the same one when the panel opens. If `/api/serve/[fileId]` returns 404 (different `/tmp`), the user sees an error and can retry by closing and reopening the panel.

### `OverlayView`

- Renders the full-page JPEG screenshot as a `<img>` base layer filling 100% width.
- A `ResizeObserver` on the `<img>` element computes `scale = img.clientWidth / img.naturalWidth` any time the image is resized (responsive layout, window resize).
- At `scale > 0`, composites three things in absolute position over the screenshot:
  1. **Dashed purple border** (`#6366f1`, 3px) around the slot region — `left: slot.x * scale`, `top: slot.y * scale`, `width: slot.width * scale`, `height: slot.height * scale`.
  2. **Creative overlay** — a `div` clipped with `overflow: hidden` at the same position and dimensions, containing `<img>` (static), `<video autoPlay muted loop>` (video), or an SVG placeholder (HTML5 ZIP).
  3. **"Your Ad" badge** — a small black monospace label pinned to the top-left of the slot.
- On slot change, scrolls the container to `slot.y * scale - 160` so the ad is visible without manual scrolling.
- No server round-trip — fully client-side, pixel-accurate, works on any site regardless of JS or CORS.

---

## `components/SlotGrid.tsx`

Renders the list of detected `AdSlot` objects as a responsive grid of cards. Each card shows:
- IAB name + dimensions
- Page position (x, y)
- Match type (CSS selector name or "IAB dimension match")
- Visibility status
- Highlight when `selectedSlotId` matches

Clicking a card calls `onSelectSlot(slot)`.

---

## `types/index.ts`

| Type | Key Fields |
|---|---|
| `CreativeType` | `'image' \| 'gif' \| 'video' \| 'html5'` |
| `Creative` | `fileId`, `fileName`, `fileType`, `mimeType`, `width`, `height`, `tempUrl`, `size` |
| `AdSlot` | `id`, `x`, `y`, `width`, `height`, `label`, `selector`, `selectorIndex`, `iabName`, `isVisible` |
| `DetectionResult` | `url`, `slots[]`, `screenshotBase64`, `pageWidth`, `pageHeight`, `pageHTML`, `detectedAt` |
| `PreviewResult` | `slotId`, `compositeImageBase64`, `creativeFileId` |
| `UploadResult` | Same fields as `Creative` |
| `AppStep` | `'upload' \| 'detect' \| 'preview'` (defined for external reference; not used in current routing) |

**`AdSlot.selectorIndex`** — critical field. Records which occurrence (0-based) of `selector` this element was when detected. Required by `injectCreativeIntoHtml()` to re-locate the exact same element in the post-JS HTML.

**`DetectionResult.pageHTML`** — the fully-rendered HTML string captured via `page.content()` after Puppeteer's JavaScript has run. Contains ad containers that the original server-rendered HTML did not have.

**`DetectionResult.detectedAt`** — ISO 8601 timestamp set by the detect-slots route. Used as the cache key for `processedForUrlRef` in `PreviewPanel` (Effect 1 re-runs only when this changes, i.e., on a new scan).

---

## `next.config.ts`

```ts
serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'sharp']
```

Tells Next.js (both Turbopack and webpack) not to bundle these packages — they must be resolved from `node_modules` at runtime. Required because:
- `@sparticuz/chromium` and `sharp` contain native Node binaries that cannot be statically bundled.
- `puppeteer-core` must dynamically locate the chromium executable at launch time.

```ts
turbopack: { root: __dirname }
```

Sets the Turbopack root to the project directory. Required for `serverExternalPackages` to resolve correctly with Turbopack.

```ts
webpack: (config, { isServer }) => {
  if (isServer) config.externals = [..., '@sparticuz/chromium', 'puppeteer-core', 'sharp'];
}
```

Mirrors `serverExternalPackages` for the webpack bundler path — both bundlers must agree or one of them will try to bundle a native binary and fail.

---

## Deployment (Vercel)

- `vercel.json` is `{}` — all configuration is in code.
- `export const maxDuration = 60` in `detect-slots/route.ts` and `screenshot/route.ts` extends function timeouts beyond the default 10s.
- On cold start of `detect-slots`, `chromium.executablePath(CHROMIUM_REMOTE_URL)` checks `/tmp` for a cached binary. If absent, downloads and extracts the ~40 MB tar from GitHub Releases. First request to a cold instance takes 15–25s total.
- `/tmp` is **instance-local and ephemeral** — each Vercel function invocation may land on a different instance with its own empty `/tmp`. This is why:
  - The screenshot route receives `creativeBase64` in the request body, not a `/tmp` path.
  - `PreviewPanel` re-fetches the creative on every panel open (`isOpen` in Effect 2 deps) instead of trusting a previous cache.
- **4.5 MB response limit** — Vercel truncates responses larger than ~4.5 MB. The `detect-slots` response contains both the JPEG screenshot base64 and the `pageHTML` string. JPEG q85 keeps the screenshot base64 well within budget; PNG previously caused intermittent response truncation failures.

---

## Known Constraints & Trade-offs

| Constraint | Why |
|---|---|
| No external storage | By design — no infrastructure dependencies beyond Vercel |
| `/tmp` is instance-local | Vercel serverless functions have isolated ephemeral filesystems |
| Creative sent as base64 in `/api/screenshot` request body | Workaround for instance isolation — client fetches and forwards the file |
| `maxDuration = 60` on detect-slots and screenshot | Puppeteer cold start + page load can exceed the default 10s limit |
| Chromium downloaded at cold start | `@sparticuz/chromium` strips the binary from the bundle; it is fetched from GitHub Releases at first invocation per warm instance |
| DOM injection fully client-side | Eliminates server round-trip (was 2–6s); DOMParser + outerHTML is ~10ms in browser |
| `outerHTML` not `XMLSerializer` | `XMLSerializer` produces XHTML; void elements like `<br>`, `<input>` break in an HTML5 iframe |
| Screenshot as JPEG q85 | ~4× smaller than PNG; keeps detect-slots response under 4.5 MB Vercel limit |
| `selectorIndex` stored at detection time | The same CSS selector may match many elements; index identifies the exact detected one |
| Creative base64 cached in `creativeBase64Ref` | Avoids re-fetching on every slot change; shared by both Screenshot and DOM tabs |
| `creativeReady` state coordinates timing | Effect 3 and screenshot effect must not run before Effect 2 finishes loading the creative |
| HTML5 ZIP shows placeholder only | ZIP extraction + HTML5 ad rendering not implemented; placeholder shown in both tabs |
| DOM preview may lack fonts/images | External stylesheets and fonts behind CORS headers are blocked by the sandboxed iframe; the `<base>` tag resolves relative paths but cannot bypass CORS |
| SSRF protection production-only | Local dev needs to hit `localhost` for testing; guard is `process.env.VERCEL` |
