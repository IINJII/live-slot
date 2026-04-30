import { AdSlot } from "@/types";
import {
  AD_SELECTORS,
  getIabName,
  IAB_SIZES,
  IAB_SIZE_TOLERANCE,
} from "./adSelectors";
import { v4 as uuidv4 } from "uuid";
import puppeteer from "puppeteer-core";
import chromium, { CHROMIUM_REMOTE_URL } from "./chromium";
import sharp from "sharp";
import * as fs from "fs";
import { getTmpFilePathById } from "./fileManager";

export async function detectAdSlots(
  url: string,
  creativeWidth = 0,
  creativeHeight = 0,
  fileId = "",
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
): Promise<{
  slots: AdSlot[];
  screenshotBase64: string;
  pageWidth: number;
  pageHeight: number;
  pageHTML: string;
}> {
  let browser = null;

  try {
    const isVercel = !!process.env.VERCEL;
    let executablePath: string;
    let args: string[];

    if (isVercel) {
      executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
      args = chromium.args;
    } else {
      const possiblePaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ];
      const found = possiblePaths.find((p) => fs.existsSync(p));
      if (!found)
        throw new Error(
          "Chrome not found. Install Google Chrome for local development.",
        );
      executablePath = found;
      args = ["--no-sandbox", "--disable-setuid-sandbox"];
    }

    browser = await puppeteer.launch({
      args,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // DPR=1 — ensures screenshot pixels = CSS pixels exactly
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    await page.setUserAgent({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Block tracking/verification scripts that slow page load but aren't ad slots.
    // KEEP: doubleclick, googlesyndication, googletagservices, amazon-adsystem,
    // adnxs, indexww, criteo, rubicon, pubmatic, openx — these inject the ad iframes we need.
    const BLOCK_HOSTS = [
      "moatads.com",
      "adsafeprotected.com",
      "scorecardresearch.com",
      "segment.com",
      "zqtk.net",
      "chartbeat.com",
      "quantserve.com",
      "newrelic.com",
      "nr-data.net",
      "krxd.net",
      "demdex.net",
      "everesttech.net",
      "branch.io",
      "snowplowanalytics.com",
      "tiqcdn.com",
      "hotjar.com",
      "fullstory.com",
      "mouseflow.com",
      "optimizely.com",
      "mparticle.com",
    ];
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      const type = req.resourceType();
      if (type === "media" || type === "font")
        return req.abort().catch(() => {});
      if (BLOCK_HOSTS.some((h) => u.includes(h))) {
        return req.abort().catch(() => {});
      }
      return req.continue().catch(() => {});
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page
      .waitForNetworkIdle({ idleTime: 800, timeout: 6000 })
      .catch(() => {});

    // Dismiss consent/cookie dialogs
    await dismissConsentDialog(page);
    await new Promise((r) => setTimeout(r, 800));
    await dismissConsentDialog(page);

    // Wait for any ad iframe/slot to appear (returns fast if already present;
    // gives ad scripts time to inject slots before we measure)
    await page
      .waitForSelector(
        'iframe[id*="google_ads_iframe"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], ins.adsbygoogle, div[id^="div-gpt-ad"]',
        { timeout: 6000 },
      )
      .catch(() => {});

    // Wait for ad count to stabilize instead of a fixed sleep.
    // Polls every 400 ms; proceeds once the count is unchanged for 1.6 s (or 7 s max).
    // This is why you see different slots on repeated scans: fixed timeouts are
    // arbitrary — ads can finish injecting anywhere from 200 ms to 5 s after first load.
    await waitForAdStability(page, 400, 1600, 7000);

    // Third dismiss pass: subscription/marketing modals (e.g. AP News) often appear
    // after ad scripts finish loading, well after the first two dismiss attempts.
    await dismissConsentDialog(page);
    await new Promise((r) => setTimeout(r, 500));

    // Detect ad slots — document-absolute coords via getBoundingClientRect + scrollX/scrollY
    const runDetection = () =>
      page.evaluate(
        (
          selectors: string[],
          iabSizes: typeof IAB_SIZES,
          tolerance: number,
        ) => {
          const seen = new Set<string>();
          const results: Array<{
            x: number;
            y: number;
            width: number;
            height: number;
            selector: string;
            selectorIndex: number;
            isVisible: boolean;
            isFixed: boolean;
          }> = [];

          const selectorCount: Record<string, number> = {};

          function isElementVisible(el: Element): boolean {
            const h = el as HTMLElement;
            if (h.hidden) return false;
            const style = window.getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            )
              return false;
            // position:fixed elements have offsetParent===null but are visually present
            if (
              h.offsetParent === null &&
              style.position !== "fixed" &&
              h.tagName !== "BODY"
            )
              return false;
            return true;
          }

          function processElement(el: Element, selector: string) {
            const rect = el.getBoundingClientRect();
            const w = rect.width;
            const h = rect.height;
            if (w < 50 || h < 30) return;

            // Skip elements nested inside large fixed overlays (subscription popups,
            // interstitials). Requires z-index > 50 so we don't incorrectly skip
            // slots inside a position:fixed app scroll container (z-index 0/auto).
            {
              const viewportArea = window.innerWidth * window.innerHeight;
              let parent = el.parentElement;
              while (parent && parent.tagName !== "BODY") {
                const ps = window.getComputedStyle(parent);
                if (ps.position === "fixed") {
                  const zIndex = parseInt(ps.zIndex, 10);
                  const pr = parent.getBoundingClientRect();
                  if (
                    !isNaN(zIndex) &&
                    zIndex > 50 &&
                    (pr.width * pr.height) / viewportArea > 0.25
                  )
                    return;
                }
                parent = parent.parentElement;
              }
            }

            const elStyle = window.getComputedStyle(el);
            const elIsFixed = elStyle.position === "fixed";

            // For fixed elements, viewport coords ARE the absolute coords (scrollX/Y irrelevant)
            const absLeft = elIsFixed
              ? Math.round(rect.left)
              : Math.round(rect.left + window.scrollX);
            const absTop = elIsFixed
              ? Math.round(rect.top)
              : Math.round(rect.top + window.scrollY);

            const key = `${absLeft}_${absTop}_${Math.round(w)}_${Math.round(h)}`;
            if (seen.has(key)) return;
            seen.add(key);

            const idx = selectorCount[selector] ?? 0;
            selectorCount[selector] = idx + 1;

            results.push({
              x: absLeft,
              y: absTop,
              width: Math.round(w),
              height: Math.round(h),
              selector,
              selectorIndex: idx,
              isVisible: isElementVisible(el),
              isFixed: elIsFixed,
            });
          }

          const combined = selectors.join(",");
          try {
            document.querySelectorAll(combined).forEach((el) => {
              for (const selector of selectors) {
                try {
                  if (el.matches(selector)) {
                    processElement(el, selector);
                    break;
                  }
                } catch {
                  /* invalid selector */
                }
              }
            });
          } catch {
            for (const selector of selectors) {
              try {
                document.querySelectorAll(selector).forEach((el) => {
                  processElement(el, selector);
                });
              } catch {
                /* invalid selector, skip */
              }
            }
          }

          // IAB dimension scan — only match near-empty containers; skip content sections
          const allDivs = document.querySelectorAll("div, aside, section");
          allDivs.forEach((el) => {
            const h = el as HTMLElement;
            const ow = h.offsetWidth;
            const oh = h.offsetHeight;
            const couldBeIab = iabSizes.some(
              (s) =>
                Math.abs(s.width - ow) <= tolerance &&
                Math.abs(s.height - oh) <= tolerance,
            );
            if (!couldBeIab) return;

            // Skip elements inside editorial content zones — ads are never nested in articles/figures
            if (el.closest('article, figure, [role="article"]')) return;

            // Real ad slots are empty containers or hold a single iframe.
            // Content sections (articles, sidebars, newsletters) have text and many children.
            const visibleText = h.innerText?.trim() ?? "";
            if (visibleText.length > 25) return;

            // Skip elements containing real images (article photos, thumbnails).
            // Genuine ad containers don't have content images before the ad loads.
            const hasContentImage = Array.from(el.querySelectorAll("img")).some(
              (img) => {
                const iw = (img as HTMLImageElement).naturalWidth;
                const ih = (img as HTMLImageElement).naturalHeight;
                return iw > 5 && ih > 5;
              },
            );
            if (hasContentImage && !el.querySelector("iframe")) return;

            const nonScriptChildren = Array.from(el.children).filter(
              (c) =>
                !["SCRIPT", "NOSCRIPT", "STYLE", "LINK"].includes(
                  (c as HTMLElement).tagName,
                ),
            );
            if (nonScriptChildren.length > 2 && !el.querySelector("iframe"))
              return;

            const rect = el.getBoundingClientRect();
            const w = Math.round(rect.width);
            const hh = Math.round(rect.height);
            const isIab = iabSizes.some(
              (s) =>
                Math.abs(s.width - w) <= tolerance &&
                Math.abs(s.height - hh) <= tolerance,
            );
            if (isIab) processElement(el, "iab-dimension-match");
          });

          return results;
        },
        AD_SELECTORS,
        IAB_SIZES,
        IAB_SIZE_TOLERANCE,
      );

    let rawSlots = await runDetection();
    console.log(`[detectSlots] Fast pass: ${rawSlots.length} slots on ${url}`);

    // Always scroll to trigger lazy-loaded below-fold ads, not just when zero found
    console.log(`[detectSlots] Adaptive scroll to capture lazy-loaded ads`);
    await adaptiveScrollPass(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForAdStability(page, 300, 900, 3000);
    const postScrollSlots = await runDetection();
    console.log(`[detectSlots] Post-scroll: ${postScrollSlots.length} slots`);
    if (postScrollSlots.length >= rawSlots.length) {
      rawSlots = postScrollSlots;
    }

    const pageHTML = await page.content();

    // Build AdSlot objects
    const slots: AdSlot[] = rawSlots.map((s) => ({
      id: uuidv4(),
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      label: `${getIabName(s.width, s.height)} ${s.width}×${s.height}`,
      iabName: getIabName(s.width, s.height),
      selector: s.selector,
      selectorIndex: s.selectorIndex,
      isVisible: s.isVisible,
      isFixed: s.isFixed,
      compositeBase64: "",
    }));

    // Deduplicate overlapping slots
    const deduped = deduplicateSlots(slots, creativeWidth, creativeHeight);

    // Load creative from /tmp if available
    let creativeBuffer: Buffer | null = null;
    let creativeNaturalW = creativeWidth;
    let creativeNaturalH = creativeHeight;

    if (fileId) {
      const creativePath = getTmpFilePathById(fileId);
      if (creativePath) {
        creativeBuffer = fs.readFileSync(creativePath);
        // If we don't have dimensions from upload, read them from the image
        if (!creativeNaturalW || !creativeNaturalH) {
          try {
            const meta = await sharp(creativeBuffer).metadata();
            creativeNaturalW = meta.width ?? 0;
            creativeNaturalH = meta.height ?? 0;
          } catch {
            /* use 0,0 */
          }
        }
      }
    }

    // Per-slot: scroll to center slot in viewport → screenshot → composite
    for (const slot of deduped) {
      try {
        // Fixed elements (sticky banners, interstitials) stay at the same viewport
        // position regardless of scroll — scrolling would only move the background,
        // making slot.y - scrollY wrong.  Scroll to 0 and use stored coords directly.
        let actualScroll = { x: 0, y: 0 };
        if (slot.isFixed) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await new Promise((r) => setTimeout(r, 200));
        } else {
          // Scroll so slot is vertically centered in the viewport
          const scrollY = Math.max(
            0,
            slot.y +
              Math.round(slot.height / 2) -
              Math.round(viewport.height / 2),
          );
          await page.evaluate((y: number) => window.scrollTo(0, y), scrollY);

          // Wait for infinite-scroll XHRs triggered by the scroll to settle before
          // measuring — without this, new content loading after the scroll shifts
          // element positions and the freshRect search finds stale coordinates.
          await page
            .waitForNetworkIdle({ idleTime: 500, timeout: 3000 })
            .catch(() => {});

          // Read the actual scroll position — the browser may cap the scroll if the
          // page is shorter than the target, making slot.y - scrollY incorrect.
          actualScroll = await page.evaluate(() => ({
            x: Math.round(window.scrollX),
            y: Math.round(window.scrollY),
          }));
        }

        // Base viewport coords: for fixed slots, stored y IS the viewport y (detected at scroll=0).
        // For normal slots, subtract the actual scroll position.
        let viewportX = slot.x - actualScroll.x;
        let viewportY = slot.y - actualScroll.y;
        let renderW = slot.width;
        let renderH = slot.height;

        // Re-measure element position AFTER scroll using proximity search.
        // We search by absolute coordinates instead of selectorIndex because:
        //   (a) new ad elements loading between detection and compositing shift
        //       DOM order, making selectorIndex[N] point to the wrong element
        //   (b) iab-dimension-match slots have no valid CSS selector to query
        // Tolerance is generous (120px) to handle content reflow (ads loading
        // can push elements well beyond a few pixels from their detected position).
        try {
          const freshRect = await page.evaluate(
            (
              slotX: number,
              slotY: number,
              slotW: number,
              slotH: number,
              sx: number,
              sy: number,
            ): {
              left: number;
              top: number;
              width: number;
              height: number;
            } | null => {
              const DIST_TOLERANCE = 400; // px — large enough for infinite-scroll reflow
              const SIZE_TOLERANCE = 30; // px — for the iab-dimension fallback pass

              let best: {
                left: number;
                top: number;
                width: number;
                height: number;
              } | null = null;
              let bestScore = Infinity;

              function tryQuery(query: string, requireSizeMatch: boolean) {
                let els: NodeListOf<HTMLElement>;
                try {
                  els = document.querySelectorAll<HTMLElement>(query);
                } catch {
                  return;
                }
                for (const el of Array.from(els)) {
                  const r = el.getBoundingClientRect();
                  if (r.width < 50 || r.height < 30) continue;
                  const elFixed =
                    window.getComputedStyle(el).position === "fixed";
                  // Fixed elements' viewport coords don't shift with scroll
                  const absX = Math.round(r.left + (elFixed ? 0 : sx));
                  const absY = Math.round(r.top + (elFixed ? 0 : sy));
                  const posDist =
                    Math.abs(absX - slotX) + Math.abs(absY - slotY);
                  if (posDist > DIST_TOLERANCE) continue;
                  const wDiff = Math.abs(r.width - slotW);
                  const hDiff = Math.abs(r.height - slotH);
                  if (
                    requireSizeMatch &&
                    (wDiff > SIZE_TOLERANCE || hDiff > SIZE_TOLERANCE)
                  )
                    continue;
                  // Score: position distance + half of size mismatch
                  const score = posDist + (wDiff + hDiff) * 0.5;
                  if (score < bestScore) {
                    bestScore = score;
                    best = {
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                    };
                  }
                }
              }

              // Pass 1: specific ad-network selectors (no size constraint needed)
              tryQuery(
                [
                  "ins.adsbygoogle",
                  'div[id^="div-gpt-ad"]',
                  'div[id*="gpt-ad"]',
                  'iframe[id*="google_ads_iframe"]',
                  'iframe[src*="doubleclick"]',
                  'iframe[src*="googlesyndication"]',
                  "[data-ad-slot]",
                  "[data-google-query-id]",
                  "div[data-ad-unit]",
                  "div[data-ad-id]",
                  'div[class*="adsbygoogle"]',
                ].join(","),
                false,
              );

              // Pass 2: any iframe/div, but must match slot size (catches iab-dimension-match slots)
              if (!best) tryQuery("iframe, div, aside", true);

              return best;
            },
            slot.x,
            slot.y,
            slot.width,
            slot.height,
            actualScroll.x,
            actualScroll.y,
          );
          if (freshRect && freshRect.width > 0 && freshRect.height > 0) {
            // Convert to absolute document coords using the scroll position at time of measurement
            const currentAbsX = freshRect.left + actualScroll.x;
            const currentAbsY = freshRect.top + actualScroll.y;

            // If infinite-scroll shifted the element more than 100px from where we scrolled,
            // re-center the viewport on its real position before screenshotting.
            if (!slot.isFixed) {
              const betterScrollY = Math.max(
                0,
                Math.round(currentAbsY + freshRect.height / 2) -
                  Math.round(viewport.height / 2),
              );
              if (Math.abs(betterScrollY - actualScroll.y) > 100) {
                await page.evaluate(
                  (y: number) => window.scrollTo(0, y),
                  betterScrollY,
                );
                await page
                  .waitForNetworkIdle({ idleTime: 300, timeout: 2000 })
                  .catch(() => {});
                actualScroll = await page.evaluate(() => ({
                  x: Math.round(window.scrollX),
                  y: Math.round(window.scrollY),
                }));
              }
            }

            // Viewport position = absolute position − current scroll
            viewportX = Math.round(currentAbsX - actualScroll.x);
            viewportY = Math.round(currentAbsY - actualScroll.y);
            renderW = Math.round(freshRect.width);
            renderH = Math.round(freshRect.height);
          }
        } catch {
          // use coordinate math from actualScroll above
        }

        // Viewport screenshot (1440×900)
        const screenshotBuf = await page.screenshot({
          type: "jpeg",
          quality: 90,
        });

        // Composite creative onto screenshot server-side using Sharp
        if (creativeBuffer && creativeNaturalW > 0 && creativeNaturalH > 0) {
          // object-fit: contain — scale creative to fit slot, preserve aspect ratio
          const scaleX = renderW / creativeNaturalW;
          const scaleY = renderH / creativeNaturalH;
          const scale = Math.min(scaleX, scaleY);
          const dw = Math.round(creativeNaturalW * scale);
          const dh = Math.round(creativeNaturalH * scale);

          // Center within slot
          const left = Math.max(0, viewportX + Math.round((renderW - dw) / 2));
          const top = Math.max(0, viewportY + Math.round((renderH - dh) / 2));

          const resized = await sharp(creativeBuffer)
            .resize(dw, dh, { fit: "fill" })
            .toBuffer();

          const composite = await sharp(screenshotBuf)
            .composite([{ input: resized, left, top }])
            .jpeg({ quality: 85 })
            .toBuffer();

          slot.compositeBase64 = composite.toString("base64");
        } else {
          // No creative — just return the viewport screenshot as-is
          slot.compositeBase64 = Buffer.from(screenshotBuf).toString("base64");
        }
      } catch (err) {
        console.error("Per-slot composite failed:", err);
        // compositeBase64 stays "" — panel will show fallback
      }
    }

    // Full-page screenshot for detection.screenshotBase64
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 150));
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 85,
    });
    const screenshotBase64 = Buffer.from(screenshotBuffer).toString("base64");

    const pageMetrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    return {
      slots: deduped,
      screenshotBase64,
      pageWidth: pageMetrics.width,
      pageHeight: pageMetrics.height,
      pageHTML,
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function dismissConsentDialog(
  page: import("puppeteer-core").Page,
): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const ACCEPT_PATTERNS = [
        /^i agree$/i,
        /^agree$/i,
        /^accept all$/i,
        /^accept cookies$/i,
        /^accept all cookies$/i,
        /^accept necessary$/i,
        /^accept$/i,
        /^got it$/i,
        /^okay$/i,
        /^ok$/i,
        /^consent$/i,
        /^continue$/i,
        /^confirm$/i,
        /^allow all$/i,
        /^allow cookies$/i,
        /^later$/i,
      ];
      const REJECT_PATTERNS = [
        /^reject all$/i,
        /^reject$/i,
        /^decline$/i,
        /^decline all$/i,
        /^no thanks$/i,
        /^manage preferences$/i,
      ];

      function isVisible(el: HTMLElement): boolean {
        if (!el.offsetParent && el.tagName !== "BODY") return false;
        const s = window.getComputedStyle(el);
        return (
          s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
        );
      }

      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, a[role="button"], [role="button"]',
        ),
      ).filter(isVisible);

      for (const pat of ACCEPT_PATTERNS) {
        const el = candidates.find((b) => pat.test(b.innerText?.trim() ?? ""));
        if (el) {
          el.click();
          return true;
        }
      }
      for (const pat of REJECT_PATTERNS) {
        const el = candidates.find((b) => pat.test(b.innerText?.trim() ?? ""));
        if (el) {
          el.click();
          return true;
        }
      }

      const SELECTORS = [
        "#onetrust-accept-btn-handler",
        "#CybotCookiebotDialogBodyButtonAccept",
        "#didomi-notice-agree-button",
        "#sp-cc-accept",
        ".css-accept-btn",
        '[class*="consent"] button[class*="accept"]',
        '[class*="consent"] button[class*="agree"]',
        '[class*="cookie"] button[class*="accept"]',
        '[class*="cookie"] button[class*="agree"]',
        '[id*="gdpr"] button',
        '[class*="privacy-banner"] button',
        '[aria-label*="agree" i]',
        '[aria-label*="accept" i]',
        '[aria-label*="consent" i]',
      ];
      for (const sel of SELECTORS) {
        try {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isVisible(el)) {
            el.click();
            return true;
          }
        } catch {
          /* invalid selector */
        }
      }

      // Close generic subscription / marketing overlays (e.g. AP News "Support AP" prompt).
      // Look for a close/dismiss button inside any large fixed-position overlay.
      const CLOSE_SELECTORS = [
        '[aria-label*="close" i]',
        '[aria-label*="dismiss" i]',
        '[data-testid*="close"]',
        '[data-testid*="dismiss"]',
        'button[class*="close"]',
        'button[class*="dismiss"]',
      ];
      for (const sel of CLOSE_SELECTORS) {
        try {
          const el = document.querySelector<HTMLElement>(sel);
          if (el && isVisible(el)) {
            el.click();
            return true;
          }
        } catch {
          /* invalid selector */
        }
      }

      // Final fallback: scan large fixed overlays for a close button.
      // Uses text/aria/class matching AND position heuristic (small button at
      // top-right of overlay) to catch SVG-icon close buttons with no text.
      try {
        const viewportArea = window.innerWidth * window.innerHeight;
        const fixedOverlays = Array.from(
          document.querySelectorAll<HTMLElement>("div, aside, section, dialog"),
        ).filter((el) => {
          const s = window.getComputedStyle(el);
          if (s.position !== "fixed") return false;
          const zIndex = parseInt(s.zIndex, 10);
          if (isNaN(zIndex) || zIndex <= 50) return false; // app scroll containers have low/no z-index
          const r = el.getBoundingClientRect();
          return (r.width * r.height) / viewportArea > 0.15;
        });
        for (const overlay of fixedOverlays) {
          const oRect = overlay.getBoundingClientRect();
          const btns = Array.from(
            overlay.querySelectorAll<HTMLElement>('button, [role="button"]'),
          );
          for (const btn of btns) {
            if (!isVisible(btn)) continue;
            const text = btn.innerText?.trim() ?? "";
            const label = (btn.getAttribute("aria-label") ?? "").toLowerCase();
            const cls = (
              typeof btn.className === "string" ? btn.className : ""
            ).toLowerCase();

            // Text / aria / class match
            const isCloseByLabel =
              /^[×✕✗⊗✖xX]$/.test(text) ||
              label.includes("close") ||
              label.includes("dismiss") ||
              cls.includes("close") ||
              cls.includes("dismiss");

            const bRect = btn.getBoundingClientRect();
            const isSmall =
              bRect.width > 0 && bRect.width < 64 && bRect.height < 64;

            // Position heuristic relative to the overlay card itself
            const isTopRightOfOverlay =
              isSmall &&
              bRect.right >= oRect.right - 80 &&
              bRect.top <= oRect.top + 80;

            // When the overlay IS the full-viewport backdrop, compare against the
            // viewport instead (backdrop rect == viewport, card is smaller inside it)
            const isFullViewportBackdrop =
              oRect.width >= window.innerWidth * 0.9 &&
              oRect.height >= window.innerHeight * 0.9;
            const isTopRightOfViewport =
              isSmall &&
              isFullViewportBackdrop &&
              bRect.right >= window.innerWidth * 0.55 &&
              bRect.top <= window.innerHeight * 0.45;

            if (isCloseByLabel || isTopRightOfOverlay || isTopRightOfViewport) {
              btn.click();
              return true;
            }
          }
        }
      } catch {
        /* never block */
      }

      return false;
    });

    if (clicked) await new Promise((r) => setTimeout(r, 600));
  } catch {
    // Never block page processing due to dialog dismissal failure
  }
}

function deduplicateSlots(
  slots: AdSlot[],
  creativeWidth = 0,
  creativeHeight = 0,
): AdSlot[] {
  const hasCreative = creativeWidth > 0 && creativeHeight > 0;
  const result: AdSlot[] = [];

  for (const slot of slots) {
    const overlapping = result.findIndex((existing) => {
      const overlapX = Math.max(
        0,
        Math.min(slot.x + slot.width, existing.x + existing.width) -
          Math.max(slot.x, existing.x),
      );
      const overlapY = Math.max(
        0,
        Math.min(slot.y + slot.height, existing.y + existing.height) -
          Math.max(slot.y, existing.y),
      );
      const overlapArea = overlapX * overlapY;
      const slotArea = slot.width * slot.height;
      const existingArea = existing.width * existing.height;
      const overlapRatio = overlapArea / Math.min(slotArea, existingArea);
      return overlapRatio > 0.7;
    });

    if (overlapping === -1) {
      result.push(slot);
    } else {
      const existing = result[overlapping];

      if (hasCreative) {
        const slotDist =
          Math.abs(slot.width - creativeWidth) +
          Math.abs(slot.height - creativeHeight);
        const existingDist =
          Math.abs(existing.width - creativeWidth) +
          Math.abs(existing.height - creativeHeight);
        if (slotDist < existingDist) result[overlapping] = slot;
        continue;
      }

      const slotArea = slot.width * slot.height;
      const existingArea = existing.width * existing.height;
      if (
        (slot.selector !== "iab-dimension-match" &&
          existing.selector === "iab-dimension-match") ||
        slotArea > existingArea
      ) {
        result[overlapping] = slot;
      }
    }
  }

  return result;
}

/**
 * Adaptive scroll pass: scrolls top → bottom in chunks to trigger lazy-loaded ad slots.
 * Exits early when (a) reached page bottom, (b) hit max budget (12000px / 8s),
 * or (c) 3 consecutive steps produce no new ad-iframe matches.
 */
async function adaptiveScrollPass(
  page: import("puppeteer-core").Page,
): Promise<void> {
  const STEP = 800;
  const MAX_Y = 12000;
  const MAX_TIME_MS = 8000;
  const SETTLE_MS = 250;
  const STALE_LIMIT = 5;

  const start = Date.now();
  let y = 0;
  let lastCount = 0;
  let staleSteps = 0;

  // Get scrollable height once
  const pageHeight = await page
    .evaluate(() => document.documentElement.scrollHeight)
    .catch(() => MAX_Y);
  const target = Math.min(pageHeight, MAX_Y);

  while (y < target) {
    if (Date.now() - start > MAX_TIME_MS) break;
    y += STEP;
    await page.evaluate((yy: number) => window.scrollTo(0, yy), y);
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const count = await page
      .evaluate(
        () =>
          document.querySelectorAll(
            'iframe[id*="google_ads_iframe"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], ins.adsbygoogle, div[id^="div-gpt-ad"]',
          ).length,
      )
      .catch(() => 0);

    if (count === lastCount) {
      staleSteps++;
      if (staleSteps >= STALE_LIMIT && count > 0) break;
    } else {
      staleSteps = 0;
      lastCount = count;
    }
  }

  // Final settle so any in-flight ad iframes finish injecting
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * Polls the count of known ad elements every `pollMs` until it has been
 * unchanged for `stableMs`, or `maxMs` elapses — whichever comes first.
 *
 * This replaces fixed sleeps: ad networks inject slots anywhere from
 * 200 ms to 5 s after first load, so a fixed timeout always loses either
 * speed or completeness.
 */
async function waitForAdStability(
  page: import("puppeteer-core").Page,
  pollMs: number,
  stableMs: number,
  maxMs: number,
): Promise<void> {
  const AD_QUERY =
    'iframe[id*="google_ads_iframe"], iframe[src*="doubleclick"], iframe[src*="googlesyndication"], ins.adsbygoogle, div[id^="div-gpt-ad"]';
  let prevCount = -1;
  let stableFor = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const count = await page
      .evaluate((q: string) => document.querySelectorAll(q).length, AD_QUERY)
      .catch(() => 0);
    if (count === prevCount) {
      stableFor += pollMs;
      if (stableFor >= stableMs) return;
    } else {
      stableFor = 0;
      prevCount = count;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
