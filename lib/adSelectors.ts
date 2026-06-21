// Known IAB standard ad sizes with friendly names
export const IAB_SIZES: { width: number; height: number; name: string }[] = [
  // Display banner sizes
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
  // Generic ad id/class patterns — case-insensitive (` i` flag) because many
  // publishers capitalize the token, e.g. GeeksforGeeks uses `GFG_AD_..._160x600`.
  // Only the delimited tokens get the ` i` flag; a bare `ad` is too broad
  // ("header", "gradient", "download", "thread" would all match).
  'div[id*="ad-slot" i]',
  'div[id*="ad_slot" i]',
  'div[id*="-ad-" i]',
  'div[id*="_ad_" i]',
  'div[id^="ad-" i]',
  'div[id^="ad_" i]',
  'div[id$="-ad" i]',
  'div[id$="_ad" i]',
  'div[class*="ad-slot" i]',
  'div[class*="ad_slot" i]',
  'div[class*="adslot" i]',
  'div[class*="ad-unit" i]',
  'div[class*="ad_unit" i]',
  'div[class*="adunit" i]',
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

// Video AD-NETWORK iframe slots. A page-level <iframe> served from one of these
// hosts is unambiguously a video ad placement (host = ad signal), so it can be
// tagged video directly — no need to see inside the cross-origin frame.
export const VIDEO_SELECTORS: string[] = [
  'iframe[src*="imasdk.googleapis.com"]',
  'iframe[src*="connatix.com"]',
  'iframe[src*="teads.tv"]',
  'iframe[src*="teads.com"]',
  'iframe[src*="primis.tech"]',
  'iframe[src*="primis.net"]',
  'iframe[src*="sekindo.com"]',
  'iframe[src*="aniview.com"]',
  'iframe[src*="spotx.tv"]',
  'iframe[src*="spotxchange.com"]',
  'iframe[src*="brid.tv"]',
  'iframe[src*="vidazoo.com"]',
  'iframe[src*="vidible.tv"]',
  'iframe[src*="unrulymedia.com"]',
  'iframe[src*="springserve.com"]',
  'iframe[src*="viralize.tv"]',
];

// An ancestor whose id/class matches this is an AD context. A bare <video> only
// counts as a video AD slot when it sits under such an ancestor (strict mode):
// video signal AND ad signal. 'video' is deliberately excluded from the pattern
// so editorial "video-gallery"/"hero-video" wrappers do not match.
export const AD_ANCESTOR_PATTERN =
  'taboola|trc[_-]|tbl-|outbrain|ob[-_]widget|google_ads_iframe|googleactiveview|div-gpt-ad|gpt-ad|out-?stream|in-?stream|vpaid|vast|teads|spotx|connatix|cnx-|primis|sekindo|aniview|vidible|ad-?unit|ad-?slot|ad-?container|adsbygoogle|advertis';
