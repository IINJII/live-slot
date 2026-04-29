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

    // Navigate with a timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait a bit for lazy-loaded ads
    await new Promise((r) => setTimeout(r, 2000));

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
          isVisible: boolean;
        }> = [];

        function processElement(el: Element, selector: string) {
          const rect = el.getBoundingClientRect();
          const scrollX = window.scrollX;
          const scrollY = window.scrollY;

          const absX = rect.left + scrollX;
          const absY = rect.top + scrollY;
          const w = rect.width;
          const h = rect.height;

          if (w < 50 || h < 30) return;

          const key = `${Math.round(absX)}_${Math.round(absY)}_${Math.round(w)}_${Math.round(h)}`;
          if (seen.has(key)) return;
          seen.add(key);

          const style = window.getComputedStyle(el);
          const isVisible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';

          results.push({
            x: Math.round(absX),
            y: Math.round(absY),
            width: Math.round(w),
            height: Math.round(h),
            selector,
            isVisible,
          });
        }

        // Query known ad selectors
        for (const selector of selectors) {
          try {
            document.querySelectorAll(selector).forEach((el) => {
              processElement(el, selector);
            });
          } catch {
            // Invalid selector, skip
          }
        }

        // Also find elements by IAB dimensions
        const allDivs = document.querySelectorAll('div, aside, section');
        allDivs.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          const isIab = iabSizes.some(
            (s) => Math.abs(s.width - w) <= tolerance && Math.abs(s.height - h) <= tolerance
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

    // Take full page screenshot
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: 'png',
    });

    const screenshotBase64 = Buffer.from(screenshotBuffer).toString('base64');

    // Capture fully-rendered HTML (post-JS, ad slots present in DOM)
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
