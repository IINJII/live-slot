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
    const wrappedCreative = `<div style="position:relative;width:${slot.width}px;height:${slot.height}px;overflow:hidden;outline:3px solid #000;flex-shrink:0;">${creativeHtml}</div>`;

    // --- Server-side injection: find slot element by selector, replace its contents ---
    // JS is stripped so we must inject at parse time, not at runtime.
    let injected = false;

    // Try the recorded CSS selector first — use selectorIndex to pick the exact nth match
    if (slot.selector) {
      try {
        const matches = root.querySelectorAll(slot.selector);
        const idx = slot.selectorIndex ?? 0;
        const el = matches[idx] ?? matches[0];
        if (el) {
          el.setAttribute('style',
            `position:relative;overflow:hidden;width:${slot.width}px;height:${slot.height}px;` +
            `max-width:${slot.width}px;max-height:${slot.height}px;display:block;flex-shrink:0;`
          );
          el.set_content(wrappedCreative);
          injected = true;
        }
      } catch {
        // invalid selector — fall through to dimension scan
      }
    }

    // Fallback: scan all divs/asides/sections for matching IAB dimensions
    if (!injected) {
      const candidates = root.querySelectorAll('div,aside,section,ins');
      for (const el of candidates) {
        const style = el.getAttribute('style') ?? '';
        const widthMatch = style.match(/width\s*:\s*(\d+)px/);
        const heightMatch = style.match(/height\s*:\s*(\d+)px/);
        if (widthMatch && heightMatch) {
          const w = parseInt(widthMatch[1], 10);
          const h = parseInt(heightMatch[1], 10);
          if (Math.abs(w - slot.width) <= 12 && Math.abs(h - slot.height) <= 12) {
            el.setAttribute('style',
              `position:relative;overflow:hidden;width:${slot.width}px;height:${slot.height}px;` +
              `max-width:${slot.width}px;max-height:${slot.height}px;display:block;flex-shrink:0;`
            );
            el.set_content(wrappedCreative);
            injected = true;
            break;
          }
        }
      }
    }

    // If we couldn't find the slot element, surface a clear error
    if (!injected) {
      return NextResponse.json({ error: 'Could not locate the ad slot element in the page HTML.' }, { status: 422 });
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
