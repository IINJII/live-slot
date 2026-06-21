import { AdSlot } from "@/types";
import {
  AD_SELECTORS,
  getIabName,
  isIabSize,
  IAB_SIZES,
  IAB_SIZE_TOLERANCE,
  VIDEO_SELECTORS,
  AD_ANCESTOR_PATTERN,
} from "./adSelectors";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import * as fs from "fs";
import { launchBrowser } from "./browser";
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
    browser = await launchBrowser();

    const page = await browser.newPage();

    // TEMP: forward in-page console.log (video-pass diagnostics) to server
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.startsWith("[video]")) console.log(t);
    });

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
          videoSelectors: string[],
          adAncestorPattern: string,
        ) => {
          const videoSelectorSet = new Set(videoSelectors);
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
            isVideoSlot: boolean;
            slotOrigin: string;
            srcId: string;
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

          // GAM/DFP slots often encode their booked size in the id, e.g.
          // `GFG_AD_Desktop_RightSideBar_Docked_160x600`. Returns {dw,dh} when a
          // plausible WxH token is present (used to rescue collapsed placeholders).
          function parseDeclaredSize(
            el: Element,
          ): { dw: number; dh: number } | null {
            const id = typeof el.id === "string" ? el.id : "";
            const m = id.match(/[_-](\d{2,4})x(\d{2,4})(?:[_-]|$)/i);
            if (!m) return null;
            const dw = parseInt(m[1], 10);
            const dh = parseInt(m[2], 10);
            if (dw < 50 || dh < 50 || dw > 1200 || dh > 1200) return null;
            return { dw, dh };
          }

          // Nearest IAB standard size within tolerance on BOTH axes (smallest
          // combined delta), else null. Reuses the iabSizes + tolerance already
          // passed into this evaluate(). Used to (a) detect when a rendered box
          // is a clean standard fill and (b) snap near-standard boxes exact.
          function nearestIab(w: number, h: number): { w: number; h: number } | null {
            let best: { w: number; h: number } | null = null;
            let bestDelta = Infinity;
            for (const s of iabSizes) {
              if (
                Math.abs(s.width - w) <= tolerance &&
                Math.abs(s.height - h) <= tolerance
              ) {
                const d = Math.abs(s.width - w) + Math.abs(s.height - h);
                if (d < bestDelta) {
                  bestDelta = d;
                  best = { w: s.width, h: s.height };
                }
              }
            }
            return best;
          }
          const isCleanIab = (w: number, h: number): boolean =>
            nearestIab(w, h) !== null;

          // The actual rendered <iframe>/<video> inside an ad container is the
          // TRUE ad footprint — neither the id label nor the wrapper box. A frame
          // that self-identifies as an ad network frame is preferred over a larger
          // generic embed (consent/social) sitting in the same container.
          const AD_FRAME_RE =
            /google_ads_iframe|doubleclick|googlesyndication|safeframe|adnxs|amazon-adsystem|gpt|ad[_-]?iframe|ad[_-]?frame/i;
          function isAdFrame(n: Element): boolean {
            const id = typeof n.id === "string" ? n.id : "";
            const src =
              (n.getAttribute && (n.getAttribute("src") || n.getAttribute("data-src"))) || "";
            const nm = (n.getAttribute && n.getAttribute("name")) || "";
            const cls = typeof (n as HTMLElement).className === "string"
              ? (n as HTMLElement).className
              : "";
            return (
              AD_FRAME_RE.test(id) ||
              AD_FRAME_RE.test(src) ||
              AD_FRAME_RE.test(nm) ||
              AD_FRAME_RE.test(cls)
            );
          }

          // Returns the largest qualifying rendered ad frame within `el` (or `el`
          // itself when it IS an iframe/video) in viewport space, or null when the
          // slot has not rendered an ad (collapsed/empty placeholder).
          function findPrimaryAdRect(
            el: Element,
          ): { w: number; h: number; left: number; top: number } | null {
            const MIN_W = 50;
            const MIN_H = 40; // skips 1x1 tracking pixels AND thin label/feedback bars (h=20..22)
            const vpArea = window.innerWidth * window.innerHeight;
            const er = el.getBoundingClientRect();
            const elArea = Math.max(0, er.width) * Math.max(0, er.height);
            const cands: Element[] = [];
            if (el.tagName === "IFRAME" || el.tagName === "VIDEO") cands.push(el);
            el.querySelectorAll("iframe, video").forEach((n) => cands.push(n));

            let best: { w: number; h: number; left: number; top: number } | null = null;
            let bestArea = -1;
            let bestIsAd = false;
            for (const n of cands) {
              const cs = window.getComputedStyle(n);
              if (cs.display === "none" || cs.visibility === "hidden") continue;
              const r = n.getBoundingClientRect();
              const w = Math.round(r.width);
              const h = Math.round(r.height);
              if (w < MIN_W || h < MIN_H) continue;
              const area = w * h;
              if (area > 0.92 * vpArea) continue; // a full-page shell/anchor frame, not an ad unit
              // Clip-box guard: only require the frame to sit inside el's box when el
              // actually HAS a box. A collapsed/overflowing wrapper (300x0, 799x0)
              // has near-zero area and cannot "contain" the frame — skip the test then.
              if (n !== el && elArea >= MIN_W * MIN_H) {
                const interW = Math.min(r.right, er.right) - Math.max(r.left, er.left);
                const interH = Math.min(r.bottom, er.bottom) - Math.max(r.top, er.top);
                if (interW <= 0 || interH <= 0) continue;
                if ((interW * interH) / area < 0.5) continue; // frame spills mostly outside el
              }
              const isAd = isAdFrame(n);
              if ((isAd && !bestIsAd) || (isAd === bestIsAd && area > bestArea)) {
                bestArea = area;
                bestIsAd = isAd;
                best = { w, h, left: r.left, top: r.top };
              }
            }
            return best;
          }

          function processElement(
            el: Element,
            selector: string,
            isVideoSlot: boolean,
          ) {
            const rect = el.getBoundingClientRect();
            // Raw rendered box, captured BEFORE any canonicalization. A box below
            // the min gate is "collapsed" — no live ad filled it during the scan.
            const rw0 = Math.round(rect.width);
            const rh0 = Math.round(rect.height);
            const renderedReal = rw0 >= 50 && rh0 >= 30;
            const declared = parseDeclaredSize(el);

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

            // ---- SIZE + ORIGIN resolution (inner-ad-footprint model) ----
            // Trust order: FILLED (the real rendered iframe/video footprint outranks
            // both the id label and the wrapper box) > BOOKED-BUT-EMPTY (id-declared
            // rescue when nothing rendered + on-screen) > HEALTHY CLEAN-IAB BOX >
            // DROP. canW/canH = reported size; cLeft/cTop = viewport-space origin.
            const isDimMatch = selector === "iab-dimension-match";
            // Dimension-scan candidates keep their own box (selected BY size) — never
            // reshaped onto a child frame.
            const ad = isDimMatch ? null : findPrimaryAdRect(el);
            let canW: number, canH: number;
            let cLeft = rect.left;
            let cTop = rect.top;
            let slotOrigin: "footprint" | "rescue" | "box" = "box";

            if (ad) {
              // FILLED: report the real ad footprint at the ad's OWN origin.
              canW = ad.w;
              canH = ad.h;
              cLeft = ad.left;
              cTop = ad.top;
              slotOrigin = "footprint";
              // Clean sub-pixel onto an exact standard size, keeping the ad CENTER
              // fixed so the overlay never drifts. A true Custom (550x310/640x380)
              // is left as-is, so a 300x250 creative cannot match it; a 300x600 fill
              // snaps to Half Page.
              const snap = nearestIab(canW, canH);
              if (snap) {
                const cx = ad.left + ad.w / 2;
                const cy = ad.top + ad.h / 2;
                canW = snap.w;
                canH = snap.h;
                cLeft = cx - canW / 2;
                cTop = cy - canH / 2;
              }
            } else if (declared) {
              // BOOKED-BUT-EMPTY: no rendered ad, but the id books a size. Rescue if
              // on-screen (excludes off-canvas carousel slides parked far right).
              const onScreen =
                rect.left >= -20 &&
                rect.top + window.scrollY >= 0 &&
                rect.left + 50 <= window.innerWidth;
              if (!onScreen) return;
              canW = declared.dw;
              canH = declared.dh;
              const boxW = renderedReal ? rw0 : canW;
              cLeft = rect.left + Math.max(0, Math.round((boxW - canW) / 2));
              cTop = rect.top;
              slotOrigin = "rescue";
            } else {
              // No inner ad, no booked size. Trust the box ONLY if it is a clean IAB
              // fill — a large NON-IAB wrapper whose frame has not painted is dropped
              // (the empty-wrapper timing-race false positive).
              if (!renderedReal) return; // collapsed + unbooked + empty -> drop
              if (!isDimMatch && isCleanIab(rw0, rh0)) {
                const n = nearestIab(rw0, rh0)!;
                canW = n.w;
                canH = n.h;
              } else if (isDimMatch) {
                canW = rw0;
                canH = rh0;
              } else {
                return; // oversized/odd non-IAB wrapper, no ad child, no id -> drop
              }
            }
            canW = Math.round(canW);
            canH = Math.round(canH);

            // For fixed elements, viewport coords ARE the absolute coords (scrollX/Y irrelevant)
            const absLeft = elIsFixed
              ? Math.round(cLeft)
              : Math.round(cLeft + window.scrollX);
            const absTop = elIsFixed
              ? Math.round(cTop)
              : Math.round(cTop + window.scrollY);

            const key = `${absLeft}_${absTop}_${canW}_${canH}`;
            if (seen.has(key)) return;
            seen.add(key);

            const idx = selectorCount[selector] ?? 0;
            selectorCount[selector] = idx + 1;

            results.push({
              x: absLeft,
              y: absTop,
              width: canW,
              height: canH,
              selector,
              selectorIndex: idx,
              isVisible: isElementVisible(el),
              isFixed: elIsFixed,
              isVideoSlot,
              slotOrigin,
              // Element id lets the composite step re-measure a rescued (collapsed)
              // slot to verify it actually reserves space before drawing over it.
              srcId: typeof el.id === "string" ? el.id : "",
            });
          }

          const allSelectors = [...selectors, ...videoSelectors];
          const combined = allSelectors.join(",");
          try {
            document.querySelectorAll(combined).forEach((el) => {
              for (const selector of allSelectors) {
                try {
                  if (el.matches(selector)) {
                    processElement(
                      el,
                      selector,
                      videoSelectorSet.has(selector),
                    );
                    break;
                  }
                } catch {
                  /* invalid selector */
                }
              }
            });
          } catch {
            for (const selector of allSelectors) {
              try {
                document.querySelectorAll(selector).forEach((el) => {
                  processElement(el, selector, videoSelectorSet.has(selector));
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
            const isDisplayIab = iabSizes.some(
              (s) =>
                Math.abs(s.width - w) <= tolerance &&
                Math.abs(s.height - hh) <= tolerance,
            );
            // The dimension scan is the weakest signal. Require BOTH visibility and
            // a real rendered ad child (iframe/video) before emitting — an IAB-sized
            // div with no ad inside is a false positive (e.g. an empty editorial
            // card, or a hidden placeholder).
            if (isDisplayIab && isElementVisible(el) && findPrimaryAdRect(el))
              processElement(el, "iab-dimension-match", false);
          });

          // ---- Native <video> ad-slot pass (STRICT: video signal AND ad signal) ----
          // A bare <video> is only a video slot when it sits under an ad-network
          // ancestor. We deep-walk open shadow roots and same-origin iframes because
          // querySelectorAll does not pierce them. Because the scanner aborts
          // resourceType==='media', the <video> itself often has no intrinsic size,
          // so we size the slot from its nearest laid-out container.
          const adAncestorRe = new RegExp(adAncestorPattern, "i");

          function hasAdAncestor(el: Element): boolean {
            let p: Element | null = el;
            let depth = 0;
            while (p && depth < 8 && p.tagName !== "BODY") {
              const pid = typeof p.id === "string" ? p.id : "";
              const pcls =
                typeof (p as HTMLElement).className === "string"
                  ? (p as HTMLElement).className
                  : "";
              if (adAncestorRe.test(pid) || adAncestorRe.test(pcls))
                return true;
              p = p.parentElement;
              depth++;
            }
            return false;
          }

          // Editorial content players / decorative background heroes are NOT ad slots.
          function isContentOrHeroVideo(v: HTMLVideoElement): boolean {
            if (v.controls || v.loop) return true;
            const win = v.ownerDocument.defaultView ?? window;
            const s = win.getComputedStyle(v);
            const r = v.getBoundingClientRect();
            if (
              s.objectFit === "cover" &&
              (r.width >= win.innerWidth * 0.9 ||
                r.height >= win.innerHeight * 0.6)
            )
              return true;
            return false;
          }

          // Climb to the first sensibly-sized ancestor — the media-blocked <video>
          // may be 0×0 or the 300×150 UA default.
          function videoSlotRect(v: HTMLVideoElement): DOMRect {
            let el: Element | null = v;
            let depth = 0;
            while (el && depth < 6) {
              const r = el.getBoundingClientRect();
              if (r.width >= 200 && r.height >= 80) return r;
              el = el.parentElement;
              depth++;
            }
            return v.getBoundingClientRect();
          }

          const videoHits: Array<{
            video: HTMLVideoElement;
            offX: number;
            offY: number;
          }> = [];

          function collectVideos(
            root: Document | ShadowRoot,
            offX: number,
            offY: number,
          ) {
            let nodes: NodeListOf<Element>;
            try {
              nodes = root.querySelectorAll("*");
            } catch {
              return;
            }
            for (const el of Array.from(nodes)) {
              if (el.tagName === "VIDEO")
                videoHits.push({ video: el as HTMLVideoElement, offX, offY });
              // open shadow roots only — closed roots return null (blind spot).
              // Shadow content shares the host's coordinate space → no offset.
              const sr = (el as HTMLElement).shadowRoot;
              if (sr) collectVideos(sr, offX, offY);
              if (el.tagName === "IFRAME") {
                let doc: Document | null = null;
                try {
                  doc = (el as HTMLIFrameElement).contentDocument;
                } catch {
                  doc = null; // cross-origin — unreadable
                }
                if (doc) {
                  const ir = el.getBoundingClientRect();
                  // child-frame coords are relative to the iframe's viewport;
                  // add the iframe's top-viewport position (+ border) to map up.
                  collectVideos(
                    doc,
                    offX + ir.left + (el as HTMLElement).clientLeft,
                    offY + ir.top + (el as HTMLElement).clientTop,
                  );
                }
              }
            }
          }
          collectVideos(document, 0, 0);

          // TEMP DIAGNOSTICS
          const vidIframeCount = results.filter((r) => r.isVideoSlot).length;
          console.log(
            `[video] videoHits=${videoHits.length} videoNetworkIframes=${vidIframeCount}`,
          );

          for (const hit of videoHits) {
            const v = hit.video;
            const dr = v.getBoundingClientRect();
            const cr = videoSlotRect(v);
            const adAnc = hasAdAncestor(v);
            const hero = isContentOrHeroVideo(v);
            console.log(
              `[video] <video> own=${Math.round(dr.width)}x${Math.round(dr.height)} container=${Math.round(cr.width)}x${Math.round(cr.height)} adAncestor=${adAnc} contentOrHero=${hero} controls=${v.controls} loop=${v.loop} cls="${(typeof v.className === "string" ? v.className : "").slice(0, 60)}"`,
            );
            if (isContentOrHeroVideo(v)) continue;
            // STRICT: a bare <video> is only a video AD slot when it sits under an
            // ad-network ancestor (out-stream unit). Content players are excluded
            // even when the page loads IMA — pre-roll renders there but it is the
            // publisher's player, not a dedicated ad placement.
            if (!hasAdAncestor(v)) continue;
            const r = videoSlotRect(v);
            const w = Math.round(r.width);
            const hh = Math.round(r.height);
            if (w < 150 || hh < 60) continue; // relaxed video min-size
            const win = v.ownerDocument.defaultView ?? window;
            const elIsFixed = win.getComputedStyle(v).position === "fixed";
            // r is in the element's frame viewport; offX/offY map to the TOP
            // viewport; window.scrollX/Y (top doc) → absolute document coords.
            const absLeft = Math.round(
              r.left + hit.offX + (elIsFixed ? 0 : window.scrollX),
            );
            const absTop = Math.round(
              r.top + hit.offY + (elIsFixed ? 0 : window.scrollY),
            );
            const key = `${absLeft}_${absTop}_${w}_${hh}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const idx = selectorCount["video-ad"] ?? 0;
            selectorCount["video-ad"] = idx + 1;
            results.push({
              x: absLeft,
              y: absTop,
              width: w,
              height: hh,
              selector: "video-ad",
              selectorIndex: idx,
              isVisible: true,
              isFixed: elIsFixed,
              isVideoSlot: true,
              slotOrigin: "video",
              srcId: "",
            });
          }

          return results;
        },
        AD_SELECTORS,
        IAB_SIZES,
        IAB_SIZE_TOLERANCE,
        VIDEO_SELECTORS,
        AD_ANCESTOR_PATTERN,
      ) as Promise<
        Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          selector: string;
          selectorIndex: number;
          isVisible: boolean;
          isFixed: boolean;
          isVideoSlot: boolean;
          slotOrigin: string;
          srcId: string;
        }>
      >;

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
      slotType: s.isVideoSlot ? ("video" as const) : ("display" as const),
      slotOrigin: s.slotOrigin as AdSlot["slotOrigin"],
      srcId: s.srcId,
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

    // Per-slot: scroll to center slot in viewport → screenshot → composite.
    // Rescued (collapsed-at-detection) slots that still don't reserve space at
    // composite time are collected here and dropped — drawing the creative there
    // would land it over page content, not an ad box.
    const dropIds = new Set<string>();
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

        // Rescued slots booked a size but rendered no ad at detection. Re-measure
        // the booked element now: if it reserves real space (filled or a sized
        // reservation), anchor the creative inside it; if it is still collapsed,
        // page content occupies that area, so DROP the slot rather than draw the
        // creative over content.
        if (slot.slotOrigin === "rescue") {
          // The slot booked a size but had not filled at detection. Now that it is
          // scrolled into view, give its (often lazy/viewability-gated) ad a real
          // chance to load: wait for network idle, then a short paint dwell. Many
          // below-fold GAM units only fill once visible — this converts a would-be
          // drop into a clean filled slot.
          await page
            .waitForNetworkIdle({ idleTime: 700, timeout: 4000 })
            .catch(() => {});
          await new Promise((r) => setTimeout(r, 600));
          // Re-measure: the rendered ad iframe/video if any, else the element box.
          const m = slot.srcId
            ? await page.evaluate((id: string) => {
                const e = document.getElementById(id);
                if (!e) return null;
                let best: {
                  left: number;
                  top: number;
                  width: number;
                  height: number;
                } | null = null;
                let bestArea = -1;
                const cands: Element[] = [e];
                e.querySelectorAll("iframe, video").forEach((n) => cands.push(n));
                for (const n of cands) {
                  if (n.tagName !== "IFRAME" && n.tagName !== "VIDEO") continue;
                  const r = n.getBoundingClientRect();
                  if (r.width < 50 || r.height < 40) continue;
                  const a = r.width * r.height;
                  if (a > bestArea) {
                    bestArea = a;
                    best = {
                      left: Math.round(r.left),
                      top: Math.round(r.top),
                      width: Math.round(r.width),
                      height: Math.round(r.height),
                    };
                  }
                }
                const er = e.getBoundingClientRect();
                return {
                  ad: best, // the real rendered ad, if one painted
                  box: {
                    left: Math.round(er.left),
                    top: Math.round(er.top),
                    width: Math.round(er.width),
                    height: Math.round(er.height),
                  },
                };
              }, slot.srcId)
            : null;

          if (!m) {
            dropIds.add(slot.id);
            continue;
          }
          if (m.ad) {
            // A real ad filled. Only composite if it is ~the booked size; if a
            // LARGER ad served here, our smaller creative would not cover it
            // (the original bleed bug) — drop instead.
            if (
              m.ad.width > slot.width + 30 ||
              m.ad.height > slot.height + 30
            ) {
              dropIds.add(slot.id);
              continue;
            }
            renderW = slot.width;
            renderH = slot.height;
            viewportX = Math.round(
              m.ad.left + Math.max(0, (m.ad.width - slot.width) / 2),
            );
            viewportY = Math.round(
              m.ad.top + Math.max(0, (m.ad.height - slot.height) / 2),
            );
          } else {
            // No ad painted. Composite only if the element still reserves a real
            // strip of space; a collapsed box means page content occupies the area.
            if (m.box.height < slot.height * 0.6 || m.box.width < slot.width * 0.6) {
              dropIds.add(slot.id);
              continue;
            }
            renderW = slot.width;
            renderH = slot.height;
            viewportX = Math.round(
              m.box.left + Math.max(0, (m.box.width - slot.width) / 2),
            );
            viewportY = m.box.top;
          }
        }

        // Re-measure element position AFTER scroll using proximity search.
        // We search by absolute coordinates instead of selectorIndex because:
        //   (a) new ad elements loading between detection and compositing shift
        //       DOM order, making selectorIndex[N] point to the wrong element
        //   (b) iab-dimension-match slots have no valid CSS selector to query
        // Tolerance is generous (120px) to handle content reflow (ads loading
        // can push elements well beyond a few pixels from their detected position).
        try {
          // Video slots (deep-walked <video> in shadow/iframe, or video-network
          // iframes) cannot be reliably re-found by a flat top-document query.
          // Rescued placeholders have NO rendered ad (still 0-height in the DOM),
          // so a proximity re-measure could latch a different nearby filled iframe.
          // Both trust the stored absolute coords instead.
          const freshRect =
            slot.slotType === "video" || slot.slotOrigin === "rescue"
              ? null
              : await page.evaluate(
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

                    function tryQuery(
                      query: string,
                      requireSizeMatch: boolean,
                    ) {
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

                    // Pass 0: the real ad IFRAME at the reported footprint size.
                    // Reported slots now carry the inner-ad-footprint size+origin, so
                    // a size-matched iframe near the stored coords is the actual ad —
                    // this latches it before the unconstrained Pass 1 can grab an
                    // oversized wrapper div.
                    tryQuery("iframe", true);

                    // Pass 1: specific ad-network selectors (no size constraint needed)
                    if (!best)
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

            // If the re-measure still latched the oversized responsive WRAPPER (e.g.
            // a 799-wide in-content box) instead of the real ad iframe, the render
            // box would be bigger than the reported footprint. Clamp to the footprint
            // size and anchor on the STORED footprint origin (slot.x/slot.y) — NOT
            // the re-found wrapper's center, which can be off by ~125px. CNN never
            // trips this (footprint == rendered box there).
            if (renderW > slot.width + 15 || renderH > slot.height + 15) {
              renderW = slot.width;
              renderH = slot.height;
              viewportX = slot.x - actualScroll.x;
              viewportY = slot.y - actualScroll.y;
            }
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
      // Drop rescued slots that turned out to reserve no real space (collapsed
      // over page content) — they have no clean preview.
      slots: deduped.filter((s) => !dropIds.has(s.id)),
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
    // Belt-and-suspenders: an invisible dimension-match should never be reported,
    // mirroring the in-browser visibility gate on the dimension scan.
    if (slot.selector === "iab-dimension-match" && !slot.isVisible) continue;

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

      // A video slot must never be collapsed into an overlapping display wrapper
      // (or vice versa) — they target different creatives. The video one wins so
      // it survives the downstream slotType==='video' filter.
      if (slot.slotType !== existing.slotType) {
        if (slot.slotType === "video") result[overlapping] = slot;
        continue;
      }

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

      // No creative: prefer the higher-confidence slot. A strong-selector match
      // beats a dimension-match; among equals, a clean standard (IAB) size beats a
      // Custom one (so a canonicalized booked size wins over a leftover wrapper);
      // only then fall back to larger area.
      const slotArea = slot.width * slot.height;
      const existingArea = existing.width * existing.height;
      const slotIsDim = slot.selector === "iab-dimension-match";
      const existingIsDim = existing.selector === "iab-dimension-match";
      const slotStd = isIabSize(slot.width, slot.height);
      const existingStd = isIabSize(existing.width, existing.height);
      if (existingIsDim && !slotIsDim) {
        result[overlapping] = slot;
      } else if (!slotIsDim) {
        if (slotStd && !existingStd) result[overlapping] = slot;
        else if (slotStd === existingStd && slotArea > existingArea)
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
