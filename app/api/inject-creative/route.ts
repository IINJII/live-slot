import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { AdSlot } from '@/types';

export const maxDuration = 30;

interface InjectRequest {
  pageHTML: string;
  baseUrl: string;
  slot: AdSlot;
  creativeBase64: string;
  creativeMimeType: string;
}

// Resolve a potentially relative URL against a base origin
function resolveUrl(value: string, base: string): string {
  if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('#')) {
    return value;
  }
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

// Rewrite all resource URLs in the parsed document to absolute
function rewriteUrls(root: ReturnType<typeof parse>, baseUrl: string) {
  // src / href / action / srcset attributes
  const attrMap: Record<string, string[]> = {
    src: ['img', 'script', 'iframe', 'video', 'audio', 'source', 'input', 'embed', 'track'],
    href: ['a', 'link', 'area', 'base'],
    action: ['form'],
    'data-src': ['img'],
    poster: ['video'],
  };

  for (const [attr, tags] of Object.entries(attrMap)) {
    for (const tag of tags) {
      root.querySelectorAll(tag).forEach((el) => {
        const val = el.getAttribute(attr);
        if (val) el.setAttribute(attr, resolveUrl(val, baseUrl));
      });
    }
  }

  // srcset (comma-separated list of "url [descriptor]")
  root.querySelectorAll('[srcset]').forEach((el) => {
    const srcset = el.getAttribute('srcset');
    if (!srcset) return;
    const rewritten = srcset
      .split(',')
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        return [resolveUrl(url, baseUrl), ...rest].join(' ');
      })
      .join(', ');
    el.setAttribute('srcset', rewritten);
  });

  // CSS url() inside style attributes
  root.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style');
    if (!style) return;
    const rewritten = style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_, u) => {
      return `url('${resolveUrl(u, baseUrl)}')`;
    });
    el.setAttribute('style', rewritten);
  });

  // Inline <style> blocks
  root.querySelectorAll('style').forEach((el) => {
    const css = el.innerHTML;
    const rewritten = css.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_, u) => {
      return `url('${resolveUrl(u, baseUrl)}')`;
    });
    el.set_content(rewritten);
  });
}

// Build the creative HTML to inject into the slot element
function buildCreativeHtml(
  creativeBase64: string,
  creativeMimeType: string,
  width: number,
  height: number
): string {
  const dataUri = `data:${creativeMimeType};base64,${creativeBase64}`;
  const style = 'width:100%;height:100%;display:block;object-fit:fill;';

  if (creativeMimeType.startsWith('video/')) {
    return `<video src="${dataUri}" style="${style}" autoplay muted loop playsinline></video>
<div style="position:absolute;bottom:4px;right:4px;background:#000;color:#fff;font-family:monospace;font-size:10px;padding:2px 6px;letter-spacing:0.1em;text-transform:uppercase;">Your Ad</div>`;
  }

  if (creativeMimeType === 'application/zip' || creativeMimeType === 'application/x-zip-compressed') {
    return `<div style="${style}background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;">
  <span style="color:#6366f1;font-family:monospace;font-size:14px;font-weight:bold;">HTML5</span>
  <span style="color:#94a3b8;font-family:monospace;font-size:11px;margin-top:4px;">Rich Media Ad</span>
</div>`;
  }

  // image / gif
  return `<img src="${dataUri}" alt="Ad Creative" style="${style}" />
<div style="position:absolute;bottom:4px;right:4px;background:#000;color:#fff;font-family:monospace;font-size:10px;padding:2px 6px;letter-spacing:0.1em;text-transform:uppercase;">Your Ad</div>`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as InjectRequest;
    const { pageHTML, baseUrl, slot, creativeBase64, creativeMimeType } = body;

    if (!pageHTML || !baseUrl || !slot || !creativeBase64 || !creativeMimeType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Parse HTML
    const root = parse(pageHTML, {
      blockTextElements: { script: true, style: true },
    });

    // --- Rewrite relative URLs to absolute ---
    rewriteUrls(root, baseUrl);

    // --- Remove existing <base> tags ---
    root.querySelectorAll('base').forEach((el) => el.remove());

    // --- Remove all <script> tags (prevents CORS JS errors in the iframe) ---
    root.querySelectorAll('script').forEach((el) => el.remove());

    // --- Remove CSP meta tags (would block resources in our iframe) ---
    root.querySelectorAll('meta[http-equiv]').forEach((el) => {
      const httpEquiv = el.getAttribute('http-equiv') ?? '';
      if (httpEquiv.toLowerCase() === 'content-security-policy') {
        el.remove();
      }
    });

    // --- Inject <base> at top of <head> so relative URLs still resolve ---
    const head = root.querySelector('head');
    const origin = new URL(baseUrl).origin;
    const baseTag = `<base href="${origin}/">`;
    if (head) {
      head.insertAdjacentHTML('afterbegin', baseTag);
    }

    // --- Build the creative HTML ---
    const creativeHtml = buildCreativeHtml(creativeBase64, creativeMimeType, slot.width, slot.height);

    // --- Inject position-aware script at end of <body> ---
    // This script runs in the iframe, measures actual element positions,
    // finds the element closest to slot.x / slot.y, and injects the creative.
    const injectionScript = `
<script>
(function() {
  var targetX = ${slot.x};
  var targetY = ${slot.y};
  var selector = ${JSON.stringify(slot.selector)};
  var creativeHtml = ${JSON.stringify(
    `<div style="position:relative;width:100%;height:100%;overflow:hidden;outline:3px solid #000;">${creativeHtml}</div>`
  )};

  function inject() {
    var matches;
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch(e) {
      matches = [];
    }

    // If selector matched nothing, try finding by IAB dimensions
    if (matches.length === 0) {
      var w = ${slot.width}, h = ${slot.height};
      matches = Array.from(document.querySelectorAll('div,aside,section')).filter(function(el) {
        var r = el.getBoundingClientRect();
        return Math.abs(r.width - w) <= 12 && Math.abs(r.height - h) <= 12;
      });
    }

    if (matches.length === 0) return;

    // Pick the element closest to the recorded slot position
    var best = null;
    var bestDist = Infinity;
    matches.forEach(function(el) {
      var r = el.getBoundingClientRect();
      var absTop = r.top + window.scrollY;
      var absLeft = r.left + window.scrollX;
      var dist = Math.abs(absLeft - targetX) + Math.abs(absTop - targetY);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    });

    if (best) {
      best.style.position = 'relative';
      best.style.overflow = 'hidden';
      best.innerHTML = creativeHtml;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
</script>`;

    const body2 = root.querySelector('body');
    if (body2) {
      body2.insertAdjacentHTML('beforeend', injectionScript);
    } else {
      root.insertAdjacentHTML('beforeend', injectionScript);
    }

    const modifiedHTML = root.toString();

    return new NextResponse(modifiedHTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('inject-creative error:', err);
    const message = err instanceof Error ? err.message : 'Injection failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
