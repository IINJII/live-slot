import { AdSlot } from '@/types';
import { AD_SELECTORS, getIabName, IAB_SIZES, IAB_SIZE_TOLERANCE } from './adSelectors';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer-core';
import chromium, { CHROMIUM_REMOTE_URL } from './chromium';

export async function detectAdSlots(url: string): Promise<{
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
      // Pass remote URL so chromium downloads the binary to /tmp at runtime
      // instead of looking for the local bin/ dir (which doesn't exist when bundled)
      executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
      args = chromium.args;
    } else {
      // Local dev: try to use system Chrome
      const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      const fs = await import('fs');
      const found = possiblePaths.find((p) => fs.existsSync(p));
      if (!found) throw new Error('Chrome not found. Install Google Chrome for local development.');
      executablePath = found;
      args = ['--no-sandbox', '--disable-setuid-sandbox'];
    }

    browser = await puppeteer.launch({
      args,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // Set a realistic desktop viewport
    await page.setViewport({ width: 1440, height: 900 });

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate to DOMContentLoaded — fast and reliable on heavy pages.
    // networkidle2 never settles on pages with trackers/ads and causes timeouts.
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });

    // Wait for network to settle up to 5s, but don't block if it never fully idles
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // Get page dimensions
    const pageMetrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    // Set viewport to full page size for screenshot
    await page.setViewport({
      width: Math.min(pageMetrics.width, 1440),
      height: Math.min(pageMetrics.height, 10000),
    });

    // Detect ad slots via known selectors + IAB size matching
    const rawSlots = await page.evaluate(
      (selectors: string[], iabSizes: typeof IAB_SIZES, tolerance: number) => {
        const seen = new Set<string>();
        const results: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          selector: string;
          selectorIndex: number;
          isVisible: boolean;
        }> = [];

        // Track how many times we've emitted each selector so we know the nth index
        const selectorCount: Record<string, number> = {};

        // Read once — values don't change during evaluate
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        function isElementVisible(el: Element): boolean {
          const h = el as HTMLElement;
          // Cheap checks first — avoid getComputedStyle unless necessary
          if (h.hidden) return false;
          if (h.offsetParent === null && h.tagName !== 'BODY') return false;
          const style = window.getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        }

        function processElement(el: Element, selector: string) {
          const rect = el.getBoundingClientRect();

          const absX = rect.left + scrollX;
          const absY = rect.top + scrollY;
          const w = rect.width;
          const h = rect.height;

          if (w < 50 || h < 30) return;

          const key = `${Math.round(absX)}_${Math.round(absY)}_${Math.round(w)}_${Math.round(h)}`;
          if (seen.has(key)) return;
          seen.add(key);

          const idx = selectorCount[selector] ?? 0;
          selectorCount[selector] = idx + 1;

          results.push({
            x: Math.round(absX),
            y: Math.round(absY),
            width: Math.round(w),
            height: Math.round(h),
            selector,
            selectorIndex: idx,
            isVisible: isElementVisible(el),
          });
        }

        // Single querySelectorAll pass for all ad selectors — one tree traversal instead of ~40
        const combined = selectors.join(',');
        try {
          document.querySelectorAll(combined).forEach((el) => {
            // Identify which selector matched this element
            for (const selector of selectors) {
              try {
                if (el.matches(selector)) {
                  processElement(el, selector);
                  break;
                }
              } catch { /* invalid selector */ }
            }
          });
        } catch {
          // Combined selector invalid — fall back to individual queries
          for (const selector of selectors) {
            try {
              document.querySelectorAll(selector).forEach((el) => {
                processElement(el, selector);
              });
            } catch { /* invalid selector, skip */ }
          }
        }

        // IAB dimension scan — pre-filter with offsetWidth/Height before forcing layout reflow
        const allDivs = document.querySelectorAll('div, aside, section');
        allDivs.forEach((el) => {
          const h = el as HTMLElement;
          const ow = h.offsetWidth;
          const oh = h.offsetHeight;
          // Cheap check: skip elements whose offset dimensions can't match any IAB size
          const couldBeIab = iabSizes.some(
            (s) => Math.abs(s.width - ow) <= tolerance && Math.abs(s.height - oh) <= tolerance
          );
          if (!couldBeIab) return;
          // Only call getBoundingClientRect() on IAB-sized candidates
          const rect = el.getBoundingClientRect();
          const w = Math.round(rect.width);
          const hh = Math.round(rect.height);
          const isIab = iabSizes.some(
            (s) => Math.abs(s.width - w) <= tolerance && Math.abs(s.height - hh) <= tolerance
          );
          if (isIab) {
            processElement(el, 'iab-dimension-match');
          }
        });

        return results;
      },
      AD_SELECTORS,
      IAB_SIZES,
      IAB_SIZE_TOLERANCE
    );

    // Run screenshot + HTML capture concurrently — saves 1-2s on large pages
    const [screenshotBuffer, pageHTML] = await Promise.all([
      page.screenshot({ fullPage: true, type: 'jpeg', quality: 85 }),
      page.content(),
    ]);

    const screenshotBase64 = Buffer.from(screenshotBuffer).toString('base64');

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
    }));

    // Deduplicate overlapping slots (keep largest when heavily overlapping)
    const deduped = deduplicateSlots(slots);

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

function deduplicateSlots(slots: AdSlot[]): AdSlot[] {
  const result: AdSlot[] = [];

  for (const slot of slots) {
    const overlapping = result.findIndex((existing) => {
      const overlapX = Math.max(0, Math.min(slot.x + slot.width, existing.x + existing.width) - Math.max(slot.x, existing.x));
      const overlapY = Math.max(0, Math.min(slot.y + slot.height, existing.y + existing.height) - Math.max(slot.y, existing.y));
      const overlapArea = overlapX * overlapY;
      const slotArea = slot.width * slot.height;
      const existingArea = existing.width * existing.height;
      const overlapRatio = overlapArea / Math.min(slotArea, existingArea);
      return overlapRatio > 0.7;
    });

    if (overlapping === -1) {
      result.push(slot);
    } else {
      // Keep the one with selector match (not just iab-dimension-match) or larger area
      const existing = result[overlapping];
      const slotArea = slot.width * slot.height;
      const existingArea = existing.width * existing.height;
      if (
        (slot.selector !== 'iab-dimension-match' && existing.selector === 'iab-dimension-match') ||
        slotArea > existingArea
      ) {
        result[overlapping] = slot;
      }
    }
  }

  return result;
}
