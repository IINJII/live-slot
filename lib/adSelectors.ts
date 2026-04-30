// Known IAB standard ad sizes with friendly names
export const IAB_SIZES: { width: number; height: number; name: string }[] = [
  { width: 728, height: 90, name: 'Leaderboard' },
  { width: 300, height: 250, name: 'Medium Rectangle' },
  { width: 320, height: 50, name: 'Mobile Banner' },
  { width: 320, height: 100, name: 'Large Mobile Banner' },
  { width: 160, height: 600, name: 'Wide Skyscraper' },
  { width: 300, height: 600, name: 'Half Page' },
  { width: 970, height: 250, name: 'Billboard' },
  { width: 970, height: 90, name: 'Super Leaderboard' },
  { width: 250, height: 250, name: 'Square' },
  { width: 200, height: 200, name: 'Small Square' },
  { width: 468, height: 60, name: 'Full Banner' },
  { width: 234, height: 60, name: 'Half Banner' },
  { width: 120, height: 600, name: 'Skyscraper' },
  { width: 120, height: 240, name: 'Vertical Banner' },
  { width: 336, height: 280, name: 'Large Rectangle' },
  { width: 580, height: 400, name: 'Netboard' },
  { width: 300, height: 1050, name: 'Portrait' },
  { width: 768, height: 1024, name: 'Tablet Interstitial' },
  { width: 480, height: 320, name: 'Smartphone Interstitial' },
];

// Tolerance in pixels when matching dimensions to IAB sizes
export const IAB_SIZE_TOLERANCE = 15;

// CSS selectors that strongly indicate an ad slot
export const AD_SELECTORS: string[] = [
  // Google AdSense
  'ins.adsbygoogle',
  // Google Ad Manager / DFP
  'div[id^="div-gpt-ad"]',
  'div[id*="gpt-ad"]',
  // Generic ad id/class patterns
  'div[id*="ad-slot"]',
  'div[id*="ad_slot"]',
  'div[id*="-ad-"]',
  'div[id*="_ad_"]',
  'div[id^="ad-"]',
  'div[id^="ad_"]',
  'div[id$="-ad"]',
  'div[id$="_ad"]',
  'div[class*="ad-slot"]',
  'div[class*="ad_slot"]',
  'div[class*="adslot"]',
  'div[class*="ad-unit"]',
  'div[class*="ad_unit"]',
  'div[class*="adunit"]',
  'div[class*="banner-ad"]',
  'div[class*="banner_ad"]',
  'div[class*="display-ad"]',
  'div[class*="advertisement"]',
  'div[class*="dfp-ad"]',
  // Data attributes
  '[data-ad-slot]',
  '[data-google-query-id]',
  '[data-ad-unit]',
  '[data-ad-id]',
  '[data-adunit]',
  '[data-dfp-ad]',
  // iFrames from known ad networks
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="googletagservices.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="moatads.com"]',
  'iframe[src*="media.net"]',
  'iframe[id*="google_ads_iframe"]',
  // Prebid / header bidding
  'div[id*="prebid"]',
  'div[id*="hb-ad"]',
  // Common publisher naming patterns (kept specific to avoid false positives on
  // news/political sites where "leaderboard" and "banner" appear in content IDs)
  'div[id*="skyscraper"]',
  'div[id*="rectangle"]',
  'div[id*="mrec"]',
  'div[id*="leaderboard-ad"]',
  'div[id*="ad-leaderboard"]',
  'div[id*="banner-ad"]',
  'div[id*="ad-banner"]',
  'div[class*="skyscraper"]',
  // Mediavine
  'div[id^="mv-target"]',
  'div[id*="mv_slot"]',
  'div[class*="mv-ad-box"]',
  'div[id*="mediavine"]',
  'div[class*="mediavine"]',
  '[data-google-query-id]',
  // CNN / WarnerMedia / news-publisher patterns
  'div[class*="ad-slot__"]',
  'div[class*="ads__"]',
  'div[data-ad-position]',
  'div[data-ad-name]',
  'div[data-ad-unit-path]',
  // Generic ad-container patterns
  'div[class*="ad-container"]',
  'div[class*="ad_container"]',
  'div[class*="ad-wrapper"]',
  'div[class*="ad_wrapper"]',
];

export function getIabName(width: number, height: number): string {
  for (const size of IAB_SIZES) {
    if (
      Math.abs(size.width - width) <= IAB_SIZE_TOLERANCE &&
      Math.abs(size.height - height) <= IAB_SIZE_TOLERANCE
    ) {
      return size.name;
    }
  }
  return `Custom ${width}×${height}`;
}

export function isIabSize(width: number, height: number): boolean {
  return IAB_SIZES.some(
    (size) =>
      Math.abs(size.width - width) <= IAB_SIZE_TOLERANCE &&
      Math.abs(size.height - height) <= IAB_SIZE_TOLERANCE
  );
}
