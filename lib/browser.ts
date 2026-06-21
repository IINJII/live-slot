import puppeteer, { Browser } from "puppeteer-core";
import fs from "fs";
import chromium, { CHROMIUM_REMOTE_URL } from "./chromium";

// Local Chrome locations probed for development (Vercel uses @sparticuz/chromium).
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/**
 * Launch a Chromium instance configured for the current environment:
 * the bundled @sparticuz/chromium binary on Vercel, a locally-installed
 * Chrome in development. Shared by the page scanner and the HTML5 creative
 * rasterizer so the launch config never diverges.
 */
export async function launchBrowser(): Promise<Browser> {
  const isVercel = !!process.env.VERCEL;

  if (isVercel) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_REMOTE_URL),
      headless: true,
    });
  }

  const found = LOCAL_CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "Chrome not found. Install Google Chrome for local development.",
    );
  }
  return puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: found,
    headless: true,
  });
}
