# LiveSlot — Full Architecture & Code Walkthrough

## What Is It?

LiveSlot is a two-page web app where you:

1. Upload an ad creative + enter a website URL
2. Get a list of every detected ad slot on that page
3. Click any slot to preview your creative composited into it (screenshot overlay or live iframe)

---

## High-Level Data Flow

```
User uploads file          → POST /api/upload        → /tmp on Vercel instance A
User clicks "Detect"       → POST /api/detect-slots  → Puppeteer opens URL, finds slots, takes screenshot
User clicks a slot         → Client fetches creative from /api/serve/[fileId] (same browser)
                           → Converts file to base64 in browser
                           → POST /api/screenshot    → Sharp composites creative onto screenshot → returns base64 PNG
```

---

## Directory Structure

```
app/
  page.tsx                  ← Page 1: upload + URL input
  results/page.tsx          ← Page 2: slot grid + preview panel
  layout.tsx                ← Fonts, global metadata
  globals.css               ← CSS variables, Tailwind base, animations
  api/
    upload/route.ts         ← Saves creative to /tmp, returns metadata
    detect-slots/route.ts   ← Triggers Puppeteer, returns slots + screenshot
    serve/[fileId]/route.ts ← Reads file from /tmp, serves as raw bytes
    screenshot/route.ts     ← Composites creative onto screenshot using Sharp
    cleanup/route.ts        ← Deletes file from /tmp

lib/
  chromium.ts               ← Thin wrapper re-exporting @sparticuz/chromium
  detectSlots.ts            ← All Puppeteer logic: launch, navigate, detect, screenshot
  adSelectors.ts            ← IAB size table + CSS selectors for ad detection
  screenshotOverlay.ts      ← Sharp-based image compositing
  fileManager.ts            ← /tmp read/write/delete helpers

components/
  PreviewPanel.tsx          ← Full-screen slide-in panel with Screenshot + Live tabs
  SlotGrid.tsx              ← Grid of detected slot cards
  LoadingSkeleton.tsx       ← Scanning animation + skeleton cards

types/index.ts              ← All shared TypeScript interfaces
next.config.ts              ← serverExternalPackages for Puppeteer/Sharp/Chromium
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
- Returns a `DetectionResult`: the URL, array of `AdSlot`s, a full-page screenshot as base64, and page dimensions.

`export const maxDuration = 60` — Vercel's way of extending the function timeout to 60s (Puppeteer needs time).

---

## API Route: `GET /api/serve/[fileId]`

**File:** `app/api/serve/[fileId]/route.ts`

- Validates that `fileId` is a valid UUID (prevents path traversal).
- Reads the file from `/tmp` via `fileManager.readTmpFile()`.
- Returns raw bytes with correct `Content-Type` header.

**Why this exists:** The browser needs a URL to display the creative thumbnail and (in PreviewPanel) to convert the file to base64. This route bridges the `/tmp` filesystem to the browser.

---

## API Route: `POST /api/screenshot`

**File:** `app/api/screenshot/route.ts`

- Accepts: `creativeBase64` (the raw file as base64), `creativeMimeType`, `slot` (position + dimensions), `screenshotBase64` (from the detection result), `pageWidth`, `pageHeight`.
- Decodes `creativeBase64` back to a `Buffer`.
- Calls `compositeCreativeOnScreenshot()` from `lib/screenshotOverlay.ts`.
- Returns the composited image as base64 PNG.

**Key design decision:** The creative is sent as base64 in the request body, not read from `/tmp`. This is because Vercel serverless functions are ephemeral and isolated — each request may hit a different instance, so `/tmp` from the upload route is not accessible here. The client fetches the file via `/api/serve/[fileId]`, converts it to base64 using `FileReader`, and sends it along.

---

## API Route: `DELETE /api/cleanup`

**File:** `app/api/cleanup/route.ts`

- Accepts `{ fileId }` in the request body.
- Validates UUID format, then calls `fileManager.deleteTmpFile()`.
- Called by the client when the user removes the creative from the form (`clearCreative()` in `page.tsx`).

---

## `lib/fileManager.ts`

Thin wrapper around Node's `fs` module for reading/writing/deleting files in `/tmp`.

- `TMP_DIR`: `/tmp` on Vercel, `os.tmpdir()` locally.
- `writeTmpFile(fileId, ext, buffer)`: writes `{fileId}.{ext}` to `/tmp`.
- `readTmpFile(fileId)`: scans `/tmp` for any file starting with `fileId`, reads it. (This handles the fact that the extension is not stored separately.)
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

**Why a separate file?** Turbopack (Next.js 16's bundler) needs `serverExternalPackages` to tell it not to bundle `@sparticuz/chromium`. For that to work, the import must appear as a **static top-level import** in a file that Turbopack can identify as external — not a dynamic `import()` inside a function. This wrapper makes that reliable.

`CHROMIUM_REMOTE_URL`: On Vercel, the bundled `bin/` directory for the chromium binary is stripped. `chromium.executablePath(url)` downloads the binary tar from this URL to `/tmp` at cold start and returns the path to the executable.

---

## `lib/detectSlots.ts`

The core Puppeteer logic.

**Steps:**

1. **Launch browser**: On Vercel, downloads chromium binary from `CHROMIUM_REMOTE_URL` to `/tmp`, uses `chromium.args` (flags for serverless: `--no-sandbox`, etc.). Locally, searches for system Chrome at known paths.
2. **Open page**: Sets a 1440×900 desktop viewport and a realistic Chrome user agent to avoid bot detection.
3. **Navigate**: `waitUntil: 'networkidle2'` + a 2-second extra wait for lazy-loaded ads.
4. **Detect slots** (inside `page.evaluate()` — runs in the browser context):
   - Loops through all `AD_SELECTORS` (CSS selectors for known ad networks) and measures each matched element's position/size via `getBoundingClientRect()`.
   - Also loops through all `div`/`aside`/`section` elements and flags any that match an IAB standard size (within 10px tolerance).
   - Deduplicates by a position+size key.
   - Filters out elements smaller than 50×30px.
5. **Screenshot**: `page.screenshot({ fullPage: true, type: 'png' })` captures the entire page.
6. **Build** `AdSlot` objects: assigns a UUID, maps dimensions to an IAB name via `getIabName()`.
7. **Deduplication pass**: if two slots overlap by >70% of the smaller one's area, keeps the one with a named CSS selector match (preferred over a generic IAB dimension match), or the larger one.

---

## `lib/adSelectors.ts`

Two things:

1. `IAB_SIZES`: a table of 19 standard IAB ad sizes (e.g. Leaderboard 728×90, Medium Rectangle 300×250). Used for both the dimension-match scan in Puppeteer and for labeling detected slots.
2. `AD_SELECTORS`: \~40 CSS selectors covering Google AdSense (`ins.adsbygoogle`), Google Ad Manager (`div[id^="div-gpt-ad"]`), data attributes (`[data-ad-slot]`), common publisher naming conventions (`div[class*="leaderboard"]`), ad network iframes, Prebid.js, and more.
3. `getIabName(w, h)`: returns the IAB name if the dimensions match (within tolerance), otherwise `"Custom WxH"`.

---

## `lib/screenshotOverlay.ts`

Uses the `sharp` library (a fast Node.js image processing library) to composite the creative onto the screenshot.

`compositeCreativeOnScreenshot()`:

1. Reads screenshot dimensions via `sharp().metadata()`.
2. Computes a scale factor (`imgWidth / pageWidth`) because the screenshot pixel dimensions may differ from the CSS page dimensions (device pixel ratio, viewport clamping, etc.).
3. Converts the slot's CSS coordinates to image pixel coordinates.
4. **Resizes the creative** to exactly fit the slot via `sharp().resize(w, h, { fit: 'fill' })`. For video files, generates an SVG placeholder with a play icon. For ZIP (HTML5), generates an SVG placeholder.
5. **Draws a dashed purple border** around the slot position on the screenshot (via an SVG overlay composited with Sharp).
6. **Composites the creative** on top of the highlighted screenshot at the slot position.
7. Returns the result as a base64 PNG string.

---

## `components/PreviewPanel.tsx`

A full-screen slide-in panel (CSS animation `panel-open`/`panel-close`). Closes on Esc or clicking the backdrop.

**Two tabs:**

**Screenshot tab:**

- On open, fetches `creative.tempUrl` (calls `/api/serve/[fileId]`).
- Converts the blob to base64 using `FileReader`.
- POSTs `{ creativeBase64, creativeMimeType, slot, screenshotBase64, pageWidth, pageHeight }` to `/api/screenshot`.
- Displays the returned `compositeImageBase64` as a full-width `<img>`.

**Live tab:**

- Embeds the target URL in an `<iframe>` with `sandbox="allow-scripts allow-same-origin"`.
- Scales the 1440px-wide iframe down to fit the container using CSS `transform: scale(factor)`.
- Overlays the creative at the slot's scaled coordinates using absolute positioning.
- If the iframe doesn't load within 9 seconds (blocked by `X-Frame-Options` / CSP), shows a "Site blocks embedding" message and prompts to use the Screenshot tab.

---

## `components/SlotGrid.tsx`

Renders the detected slots as a grid of cards. Each card shows:

- IAB name + dimensions
- Position on page
- Whether the selector match was a named ad selector or a dimension-match
- A highlight indicator on the selected slot

Clicking a card calls `onSelectSlot(slot)` → opens `PreviewPanel`.

---

## `next.config.ts`

```ts
serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "sharp"];
```

This tells Next.js (both Turbopack and Webpack) **not to bundle** these three packages. Instead they are required at runtime from `node_modules`. This is mandatory because:

- `@sparticuz/chromium` contains native binaries that cannot be bundled.
- `sharp` has native C++ addons.
- `puppeteer-core` needs to dynamically load the chromium executable path.

The `webpack` block mirrors the same externals for the Webpack build path (used in production by Vercel when not using Turbopack).

---

## Deployment (Vercel)

- `vercel.json` is empty `{}`. All configuration is in the code.
- `export const maxDuration = 60` in `detect-slots/route.ts` and `screenshot/route.ts` extends those functions to 60s (Puppeteer startup + page load can take 20–30s on a cold start).
- Chromium binary is downloaded to `/tmp` on first invocation of detect-slots, cached for the lifetime of the warm instance.
- The `/tmp` filesystem is instance-local and ephemeral. This is why the screenshot route does **not** read from `/tmp` — the client sends the file contents directly.

---

## `types/index.ts` — Shared Types

| Type              | Purpose                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Creative`        | Metadata about the uploaded file: `fileId`, `fileName`, `fileType`, `mimeType`, `width`, `height`, `tempUrl`, `size` |
| `AdSlot`          | A detected slot: `id`, `x`, `y`, `width`, `height`, `label`, `iabName`, `selector`, `isVisible`                      |
| `DetectionResult` | Full result from `/api/detect-slots`: `url`, `slots[]`, `screenshotBase64`, `pageWidth`, `pageHeight`, `detectedAt`  |
| `PreviewResult`   | Result from `/api/screenshot`: `slotId`, `compositeImageBase64`                                                      |
| `UploadResult`    | Result from `/api/upload`: same fields as `Creative`                                                                 |

---

## Known Constraints & Trade-offs

| Constraint                                   | Why                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No external storage (S3, DB, etc.)           | By design — no backend dependencies beyond Vercel                                                                                |
| `/tmp` is instance-local                     | Vercel serverless functions don't share filesystems; each invocation may land on a different instance                            |
| Creative sent as base64 to `/api/screenshot` | Workaround for the above — client re-fetches the file and forwards it                                                            |
| `maxDuration = 60`                           | Puppeteer cold start on Vercel takes 15–25s; default 10s timeout would always fail                                               |
| Chromium downloaded at runtime               | The `@sparticuz/chromium` package strips the binary from the bundle; it must be fetched from GitHub Releases on first cold start |
| Live iframe blocked for many sites           | Most major sites set `X-Frame-Options: SAMEORIGIN` or CSP `frame-ancestors 'none'`; Screenshot tab is the reliable fallback      |
