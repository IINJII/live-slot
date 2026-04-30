# LiveSlot — Architecture & Code Walkthrough

## What Is It?

LiveSlot is a two-page web app where you:

1. Upload an ad creative + enter a website URL
2. Get a list of every detected ad slot on that page
3. Click any slot to preview your creative composited into it — via screenshot overlay or a DOM-injected live render

---

## High-Level Data Flow

```
User uploads file          → POST /api/upload
                           → Saves to /tmp, returns Creative metadata + tempUrl

User clicks "Detect"       → POST /api/detect-slots
                           → Puppeteer opens URL, detects slots, takes screenshot,
                             captures post-JS HTML via page.content()
                           → Returns DetectionResult (slots, screenshot, pageHTML, dimensions)

User clicks a slot         → Opens PreviewPanel

  [Screenshot tab]         → Client fetches creative from /api/serve/[fileId]
                           → Converts to base64 via FileReader
                           → POST /api/screenshot (creativeBase64 + slot + screenshotBase64)
                           → Sharp composites creative onto screenshot
                           → Returns base64 PNG

  [DOM Preview tab]        → Client fetches creative from /api/serve/[fileId]
                           → Converts to base64 via FileReader
                           → POST /api/inject-creative (creativeBase64 + slot + pageHTML)
                           → node-html-parser strips scripts, rewrites URLs, injects creative
                             into slot element by CSS selector + selectorIndex
                           → Returns full HTML string
                           → Rendered in <iframe srcdoc> in the browser
```

---

## Directory Structure

```
app/
  page.tsx                      ← Page 1: upload + URL input
  results/page.tsx              ← Page 2: slot grid + preview panel
  layout.tsx                    ← Fonts, global metadata
  globals.css                   ← CSS variables, Tailwind base, animations
  api/
    upload/route.ts             ← Saves creative to /tmp, returns metadata
    detect-slots/route.ts       ← Triggers Puppeteer, returns slots + screenshot + pageHTML
    serve/[fileId]/route.ts     ← Reads file from /tmp, serves as raw bytes
    screenshot/route.ts         ← Composites creative onto screenshot using Sharp
    inject-creative/route.ts    ← Parses pageHTML, injects creative, returns modified HTML
    cleanup/route.ts            ← Deletes file from /tmp

lib/
  chromium.ts                   ← Thin wrapper re-exporting @sparticuz/chromium
  detectSlots.ts                ← All Puppeteer logic: launch, navigate, detect, screenshot
  adSelectors.ts                ← IAB size table + CSS selectors for ad detection
  screenshotOverlay.ts          ← Sharp-based image compositing
  fileManager.ts                ← /tmp read/write/delete helpers

components/
  PreviewPanel.tsx              ← Full-screen slide-in panel with Screenshot + DOM Preview tabs
  SlotGrid.tsx                  ← Grid of detected slot cards
  LoadingSkeleton.tsx           ← Scanning animation + skeleton cards

types/index.ts                  ← All shared TypeScript interfaces
next.config.ts                  ← serverExternalPackages for Puppeteer/Sharp/Chromium
```

---

## Page 1 — `app/page.tsx`

The entry point. Purely client-side (`'use client'`).

**What it does:**

- Drag-and-drop or click-to-browse file upload. Validates MIME type and 50 MB limit in the browser before touching the server.
- On file select → `POST /api/upload` → gets back a `Creative` object with `fileId`, dimensions, MIME type.
- On submit → saves all creative metadata to `sessionStorage` (so if the user navigates back, the form is pre-filled) → navigates to `/results?fileId=xxx&url=https://...`

**Why sessionStorage?** The creative file itself lives in `/tmp` on a Vercel function instance. Metadata (fileName, fileType, width, height) lives in sessionStorage so it can be restored on the results page without another network call.

---

## Page 2 — `app/results/page.tsx`

Also fully client-side (`'use client'`), wrapped in a `<Suspense>` boundary because it uses `useSearchParams()`.

**What it does:**

1. Reads `fileId` and `url` from URL search params.
2. Restores `Creative` metadata from `sessionStorage`.
3. On mount → `POST /api/detect-slots` with just the `url`. The backend does all the heavy work and returns the full `DetectionResult`.
4. Renders `<SlotGrid>` with the detected slots.
5. When a slot is clicked → opens `<PreviewPanel>` with the slot + creative + detection result.

---

## API Route: `POST /api/upload`

**File:** `app/api/upload/route.ts`

- Reads the `multipart/form-data` body.
- Validates MIME type against an allowlist and enforces 50 MB max.
- Generates a UUID (`fileId`).
- Writes the file to `/tmp/{fileId}.{ext}` via `lib/fileManager.ts`.
- For images/GIFs, uses Sharp to read pixel dimensions.
- Returns a `UploadResult` JSON with `fileId`, `fileName`, `fileType`, `mimeType`, `width`, `height`, `tempUrl`, `size`.

`tempUrl` is `/api/serve/{fileId}` — a browser-accessible URL to retrieve the file later.

---

## API Route: `POST /api/detect-slots`

**File:** `app/api/detect-slots/route.ts`

- Validates the URL (must be `http:` or `https:`, blocks private IPs on Vercel).
- Calls `detectAdSlots(url)` from `lib/detectSlots.ts`.
- Returns a `DetectionResult`: `url`, array of `AdSlot`s, full-page screenshot as base64, page dimensions, and the fully-rendered `pageHTML`.

`export const maxDuration = 60` — extends the Vercel function timeout to 60s (Puppeteer needs time).

---

## API Route: `GET /api/serve/[fileId]`

**File:** `app/api/serve/[fileId]/route.ts`

- Validates that `fileId` is a valid UUID (prevents path traversal).
- Reads the file from `/tmp` via `fileManager.readTmpFile()`.
- Returns raw bytes with correct `Content-Type` header.

**Why this exists:** The browser needs a URL to display the creative thumbnail and to convert the file to base64 for the screenshot and DOM preview routes. This bridges the `/tmp` filesystem to the browser.

---

## API Route: `POST /api/screenshot`

**File:** `app/api/screenshot/route.ts`

- Accepts: `creativeBase64`, `creativeMimeType`, `slot`, `screenshotBase64`, `pageWidth`, `pageHeight`.
- Decodes `creativeBase64` back to a `Buffer`.
- Calls `compositeCreativeOnScreenshot()` from `lib/screenshotOverlay.ts`.
- Returns the composited image as base64 PNG.

**Key design decision:** The creative is sent as base64 in the request body, not read from `/tmp`. Vercel serverless functions are ephemeral and isolated — each request may hit a different instance, so `/tmp` from the upload route is not accessible here. The client fetches the file via `/api/serve/[fileId]`, converts it to base64 using `FileReader`, and sends it along.

---

## API Route: `POST /api/inject-creative`

**File:** `app/api/inject-creative/route.ts`

The core of the DOM Preview tab. Takes the fully-rendered page HTML captured by Puppeteer and returns a modified version with the creative injected directly into the detected slot element.

**Steps:**

1. **Parse HTML** with `node-html-parser` (`blockTextElements: { script: true, style: true }` so inline scripts are preserved as text nodes for removal).
2. **Rewrite relative URLs** to absolute — `src`, `href`, `srcset`, `action`, `data-src`, `poster`, inline `style` attributes, and `<style>` blocks are all scanned. Every relative URL is resolved against the page's `baseUrl` via `new URL(value, base).href`.
3. **Strip all `<script>` tags** — prevents CORS JS errors from firing inside the iframe, and avoids ad network scripts trying to load new ads over the injected one.
4. **Strip CSP `<meta http-equiv>` tags** — `Content-Security-Policy` meta tags would block the `data:` URI creative inside the iframe.
5. **Inject `<base href="{origin}/">` ** at the top of `<head>` — ensures any remaining relative URLs in CSS or HTML resolve correctly.
6. **Build creative HTML** as a `data:` URI embedded directly in the markup:
   - **Image / GIF** → `<img src="data:...">` with `object-fit:contain`
   - **Video** → `<video src="data:..." autoplay muted loop>`
   - **ZIP / HTML5** → placeholder div (full extraction not yet implemented)
   - All wrapped in a `<div>` with explicit `width`, `height`, `overflow:hidden`
7. **Locate the slot element** server-side using the recorded `selector` + `selectorIndex`:
   - `root.querySelectorAll(selector)[selectorIndex]` picks the exact nth match of the selector — not always the first one — which is how the correct slot is identified when the same selector matches multiple elements on the page.
   - Fallback: if the selector fails or matches nothing, scan all `div/aside/section/ins` elements for one with matching inline `width`/`height` pixel values (within 12px tolerance).
   - If neither strategy finds the element → return HTTP 422.
8. **Replace the slot element's contents** with the creative HTML and override its inline style to clamp dimensions to exactly `slot.width × slot.height`.
9. Return the full modified HTML as `text/html`.

**Why server-side injection?** All `<script>` tags are stripped before the HTML reaches the browser iframe. A runtime injection script (the previous approach) would be stripped along with all other scripts and never execute. Injecting at parse time on the server sidesteps this entirely.

**`selectorIndex`:** During slot detection, Puppeteer records each slot's position in the list of matches for its selector (the 0-based index of that element among all `document.querySelectorAll(selector)` results). This index is stored on the `AdSlot` object and sent to the inject route. Without it, the route would always inject into the first matching element regardless of which slot the user selected.

---

## API Route: `DELETE /api/cleanup`

**File:** `app/api/cleanup/route.ts`

- Accepts `{ fileId }` in the request body.
- Validates UUID format, then calls `fileManager.deleteTmpFile()`.
- Called by the client when the user removes the creative from the form.

---

## `lib/fileManager.ts`

Thin wrapper around Node's `fs` module for reading/writing/deleting files in `/tmp`.

- `TMP_DIR`: `/tmp` on Vercel, `os.tmpdir()` locally.
- `writeTmpFile(fileId, ext, buffer)`: writes `{fileId}.{ext}` to `/tmp`.
- `readTmpFile(fileId)`: scans `/tmp` for any file starting with `fileId`, reads it.
- `deleteTmpFile(fileId)`: same scan + unlink.
- `getTmpFilePathById(fileId)`: returns the full path or null.

---

## `lib/chromium.ts`

A one-purpose file: a static re-export of `@sparticuz/chromium`.

```ts
import chromium from "@sparticuz/chromium";
export default chromium;
export const CHROMIUM_REMOTE_URL =
  "https://github.com/...chromium-v148.0.0-pack.x64.tar";
```

**Why a separate file?** Turbopack needs `serverExternalPackages` to tell it not to bundle `@sparticuz/chromium`. For that to work, the import must appear as a **static top-level import** in a file Turbopack can identify as external — not a dynamic `import()` inside a function. This wrapper makes that reliable.

`CHROMIUM_REMOTE_URL`: On Vercel, the bundled `bin/` directory for the chromium binary is stripped. `chromium.executablePath(url)` downloads the binary tar from this URL to `/tmp` at cold start and returns the path to the executable.

---

## `lib/detectSlots.ts`

The core Puppeteer logic.

**Steps:**

1. **Launch browser**: On Vercel, downloads chromium binary from `CHROMIUM_REMOTE_URL`. Locally, searches for system Chrome at known paths.
2. **Open page**: Sets a 1440×900 desktop viewport and a realistic Chrome user agent to avoid bot detection.
3. **Navigate**: `waitUntil: 'networkidle2'` + a 2-second extra wait for lazy-loaded ads.
4. **Detect slots** (inside `page.evaluate()` — runs in the browser context):
   - Loops through all `AD_SELECTORS` and measures each matched element via `getBoundingClientRect()`.
   - Also scans all `div/aside/section` elements for IAB standard dimensions (within 10px tolerance).
   - Deduplicates by a position+size key.
   - Tracks `selectorIndex`: as each element is emitted for a given selector, a counter increments — so the first match gets index 0, the second gets index 1, etc.
   - Filters out elements smaller than 50×30px.
5. **Screenshot**: `page.screenshot({ fullPage: true })` captures the entire page.
6. **Capture HTML**: `page.content()` returns the fully-rendered post-JS HTML. This is what gets passed to `/api/inject-creative` — it contains all ad slot elements that were added to the DOM by JavaScript, not just what was in the original HTML source.
7. **Build `AdSlot` objects**: assigns a UUID, maps dimensions to an IAB name, includes `selector` and `selectorIndex`.
8. **Deduplication pass**: if two slots overlap by >70% of the smaller one's area, keeps the one with a named CSS selector (preferred over a generic IAB dimension match), or the larger one.

---

## `lib/adSelectors.ts`

1. `IAB_SIZES`: a table of 19 standard IAB ad sizes (Leaderboard 728×90, Medium Rectangle 300×250, etc.).
2. `AD_SELECTORS`: ~40 CSS selectors covering Google AdSense, Google Ad Manager, `[data-ad-slot]`, common publisher class names, ad network iframes, Prebid.js, and more.
3. `getIabName(w, h)`: returns the IAB name if dimensions match (within tolerance), otherwise `"Custom WxH"`.

---

## `lib/screenshotOverlay.ts`

Uses `sharp` to composite the creative onto the full-page screenshot.

`compositeCreativeOnScreenshot()`:

1. Reads screenshot dimensions via `sharp().metadata()`.
2. Computes a scale factor (`imgWidth / pageWidth`) to convert CSS coordinates to image pixel coordinates.
3. **Resizes the creative** to fit the slot via `sharp().resize(w, h, { fit: 'contain' })` — scales the creative to fit entirely within the slot dimensions without distortion, letterboxing if aspect ratios differ.
4. **Draws a dashed border** around the slot position on the screenshot via an SVG overlay.
5. **Composites the creative** on top of the highlighted screenshot at the slot position.
6. Returns the result as a base64 PNG string.

---

## `components/PreviewPanel.tsx`

A full-screen slide-in panel (CSS animation `panel-open` / `panel-close`). Closes on Esc or clicking the backdrop. Body scroll is locked while open.

**Two tabs:**

### Screenshot tab

- On open, fetches `creative.tempUrl` → converts blob to base64 via `FileReader`.
- POSTs to `/api/screenshot` with `creativeBase64`, `slot`, `screenshotBase64`, `pageWidth`, `pageHeight`.
- Displays the returned `compositeImageBase64` as a full-width `<img>`.
- Loads eagerly on panel open regardless of active tab.

### DOM Preview tab

- Loads **lazily** — fetch only fires when this tab is first activated for a given slot.
- Fetches `creative.tempUrl` → converts to base64 → POSTs to `/api/inject-creative` with `pageHTML`, `baseUrl`, `slot`, `creativeBase64`, `creativeMimeType`.
- Renders the returned HTML in a `<iframe srcdoc={html}>` — not `src` — to avoid CORS issues.
- The iframe is scaled via CSS `transform: scale(containerWidth / 1440)` to fit the panel width.
- Auto-scrolls to `slot.y * scale` on load so the injected creative is in view.
- **Slot switching:** reset + fetch are in a single `useEffect` keyed on `slot.id`. It immediately sets `isLoadingDom = true` before clearing `domHtml`, so there is never a blank-screen flash between slots. A `cancelled` flag prevents stale responses from a previous fetch overwriting the current slot's result.

---

## `components/SlotGrid.tsx`

Renders detected slots as a grid of cards. Each card shows IAB name, dimensions, page position, and whether the match came from a named CSS selector or an IAB dimension scan. Clicking a card opens `PreviewPanel`.

---

## `next.config.ts`

```ts
serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "sharp"]
```

Tells Next.js not to bundle these packages — they are required at runtime from `node_modules`. Mandatory because `@sparticuz/chromium` and `sharp` contain native binaries that cannot be bundled, and `puppeteer-core` needs to dynamically locate the chromium executable.

---

## Deployment (Vercel)

- `vercel.json` is empty `{}`. All configuration is in code.
- `export const maxDuration = 60` in `detect-slots/route.ts` and `export const maxDuration = 30` in `inject-creative/route.ts` extend function timeouts beyond the default 10s.
- Chromium binary is downloaded to `/tmp` on the first cold start of `detect-slots`, then cached for the lifetime of the warm instance.
- `/tmp` is instance-local and ephemeral — this is why both `/api/screenshot` and `/api/inject-creative` receive the creative as base64 in the request body rather than reading from `/tmp`.

---

## `types/index.ts` — Shared Types

| Type              | Key Fields                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `Creative`        | `fileId`, `fileName`, `fileType`, `mimeType`, `width`, `height`, `tempUrl`, `size`                     |
| `AdSlot`          | `id`, `x`, `y`, `width`, `height`, `label`, `iabName`, `selector`, `selectorIndex`, `isVisible`        |
| `DetectionResult` | `url`, `slots[]`, `screenshotBase64`, `pageWidth`, `pageHeight`, `pageHTML`, `detectedAt`              |
| `PreviewResult`   | `slotId`, `compositeImageBase64`, `creativeFileId`                                                     |
| `UploadResult`    | Same fields as `Creative`                                                                              |

---

## Known Constraints & Trade-offs

| Constraint | Why |
| --- | --- |
| No external storage | By design — no backend dependencies beyond Vercel |
| `/tmp` is instance-local | Vercel serverless functions don't share filesystems; each invocation may land on a different instance |
| Creative sent as base64 in request body | Workaround for the above — client re-fetches the file and forwards it to screenshot and inject-creative routes |
| `maxDuration = 60` on detect-slots | Puppeteer cold start on Vercel takes 15–25s; default 10s timeout would always fail |
| Chromium downloaded at runtime | `@sparticuz/chromium` strips the binary from the bundle; it must be fetched from GitHub Releases on first cold start |
| All `<script>` tags stripped in DOM preview | Prevents CORS errors from ad network scripts inside the iframe; means injection must happen server-side at parse time |
| `selectorIndex` required for correct slot targeting | The same CSS selector (e.g. `div.ad-slot`) can match many elements; index records which one was detected |
| HTML5 ZIP creatives show placeholder only | Extracting and inlining a ZIP bundle's assets is not yet implemented |
| DOM preview may look incomplete | CSS loaded via external stylesheets resolves correctly (base tag + absolute URLs), but fonts and images behind CORS headers may not load in the sandboxed iframe |
