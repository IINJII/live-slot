import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import { launchBrowser } from "./browser";

export interface Html5Render {
  pngBuffer: Buffer;
  width: number;
  height: number;
}

// Pick the entry HTML inside an extracted creative: prefer an index.html, then
// the shallowest .html (handles ZIPs that nest the creative in a subfolder).
function findHtmlEntry(dir: string): string | null {
  const found: { p: string; depth: number; isIndex: boolean }[] = [];
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.html?$/i.test(e.name))
        found.push({ p: full, depth, isIndex: /^index\.html?$/i.test(e.name) });
    }
  };
  walk(dir, 0);
  if (!found.length) return null;
  found.sort(
    (a, b) => Number(b.isIndex) - Number(a.isIndex) || a.depth - b.depth,
  );
  return found[0].p;
}

// IAB HTML5 creatives declare their size via <meta name="ad.size"
// content="width=300,height=250">. Attribute order varies, so we match the
// whole tag then pull width/height out of it.
function parseAdSize(html: string): { width: number; height: number } | null {
  const meta = html.match(/<meta[^>]*ad\.size[^>]*>/i);
  if (meta) {
    const w = meta[0].match(/width\s*=\s*(\d+)/i);
    const h = meta[0].match(/height\s*=\s*(\d+)/i);
    if (w && h) {
      const width = parseInt(w[1], 10);
      const height = parseInt(h[1], 10);
      if (width >= 10 && height >= 10) return { width, height };
    }
  }
  return null;
}

/**
 * Extract an HTML5 ad ZIP, determine its size, and rasterize it to a PNG so the
 * rest of the pipeline (Sharp compositing, slot matching) can treat it exactly
 * like a static image. Size comes from the IAB `ad.size` meta tag; if absent we
 * fall back to measuring the largest laid-out element, then to 300×250.
 */
export async function renderHtml5Creative(
  input: Buffer,
  kind: "zip" | "html" = "zip",
): Promise<Html5Render> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-h5-"));
  let browser = null;
  try {
    if (kind === "html") {
      // Standalone .html (expected to be self-contained — inline/remote assets).
      fs.writeFileSync(path.join(workDir, "index.html"), input);
    } else {
      new AdmZip(input).extractAllTo(workDir, true);
    }
    const entry = findHtmlEntry(workDir);
    if (!entry)
      throw new Error(
        kind === "html"
          ? "Could not read the HTML file."
          : "No HTML file found in the ZIP archive.",
      );

    const html = fs.readFileSync(entry, "utf8");
    let dims = parseAdSize(html);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({
      width: dims?.width ?? 970,
      height: dims?.height ?? 600,
      deviceScaleFactor: 2,
    });

    await page
      .goto("file://" + entry, { waitUntil: "load", timeout: 15000 })
      .catch(() => {});
    // Let the ad paint its initial frame (animations, font/asset loads).
    await new Promise((r) => setTimeout(r, 1200));

    if (!dims) {
      const measured = await page.evaluate(() => {
        let best = { w: 0, h: 0, area: 0 };
        for (const el of Array.from(document.body.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          if (
            area > best.area &&
            r.width <= window.innerWidth + 4 &&
            r.height <= window.innerHeight + 4
          ) {
            best = { w: Math.round(r.width), h: Math.round(r.height), area };
          }
        }
        return best;
      });
      dims =
        measured.w >= 50 && measured.h >= 30
          ? { width: measured.w, height: measured.h }
          : { width: 300, height: 250 };
      await page.setViewport({
        width: dims.width,
        height: dims.height,
        deviceScaleFactor: 2,
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    const shot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: dims.width, height: dims.height },
    });

    return { pngBuffer: Buffer.from(shot), width: dims.width, height: dims.height };
  } finally {
    if (browser) await browser.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
