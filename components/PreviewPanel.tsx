'use client';

import { useEffect, useRef, useState } from 'react';
import { AdSlot, Creative, DetectionResult, PreviewResult } from '@/types';

const PAGE_RENDER_WIDTH = 1440;

type ActiveTab = 'screenshot' | 'dom';

// ---------------------------------------------------------------------------
// Phase 1 — pre-process page HTML once per detection session (browser-side)
// Strips scripts/CSP, rewrites relative URLs to absolute, injects <base> tag.
// Uses native DOMParser so URL resolution is identical to the browser engine.
// ---------------------------------------------------------------------------
function preprocessHtml(html: string, baseUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove all <script> tags — prevents CORS JS errors in the sandboxed iframe
  doc.querySelectorAll('script').forEach(el => el.remove());

  // Remove CSP meta tags — would block data: URIs and external resources
  doc.querySelectorAll('meta[http-equiv]').forEach(el => {
    if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy') {
      el.remove();
    }
  });

  // Remove existing <base> tags
  doc.querySelectorAll('base').forEach(el => el.remove());

  // Inject <base href="{origin}/"> at top of <head> so remaining relative URLs resolve
  const origin = new URL(baseUrl).origin;
  const base = doc.createElement('base');
  base.setAttribute('href', origin + '/');
  doc.head.insertBefore(base, doc.head.firstChild);

  // Rewrite src / href / srcset / action / data-src / poster to absolute
  const attrTagMap: [string, string][] = [
    ['src',      'img,script,iframe,video,audio,source,input,embed,track'],
    ['href',     'a,link,area'],
    ['action',   'form'],
    ['data-src', 'img'],
    ['poster',   'video'],
  ];
  for (const [attr, selector] of attrTagMap) {
    doc.querySelectorAll(selector).forEach(el => {
      const val = el.getAttribute(attr);
      if (!val || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('#')) return;
      try { el.setAttribute(attr, new URL(val, baseUrl).href); } catch { /* leave as-is */ }
    });
  }

  // Rewrite srcset (comma-separated "url [descriptor]" pairs)
  doc.querySelectorAll('[srcset]').forEach(el => {
    const srcset = el.getAttribute('srcset');
    if (!srcset) return;
    el.setAttribute('srcset', srcset.split(',').map(part => {
      const [url, ...rest] = part.trim().split(/\s+/);
      try { return [new URL(url, baseUrl).href, ...rest].join(' '); } catch { return part; }
    }).join(', '));
  });

  // Rewrite url() inside inline style attributes
  doc.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style');
    if (!style) return;
    el.setAttribute('style', style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_, u) => {
      if (u.startsWith('data:') || u.startsWith('blob:')) return `url('${u}')`;
      try { return `url('${new URL(u, baseUrl).href}')`; } catch { return `url('${u}')`; }
    }));
  });

  // Rewrite url() inside inline <style> blocks
  doc.querySelectorAll('style').forEach(el => {
    el.textContent = (el.textContent ?? '').replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (_, u) => {
      if (u.startsWith('data:') || u.startsWith('blob:')) return `url('${u}')`;
      try { return `url('${new URL(u, baseUrl).href}')`; } catch { return `url('${u}')`; }
    });
  });

  // Use outerHTML (HTML5 serialization) — NOT XMLSerializer which outputs XHTML
  // and breaks void elements like <br/>, <input/> inside an HTML5 iframe
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}

// ---------------------------------------------------------------------------
// Phase 2 — inject creative into pre-processed HTML for a specific slot
// Runs synchronously in ~10ms per slot. No network call.
// ---------------------------------------------------------------------------
function injectCreativeIntoHtml(
  processedHtml: string,
  slot: AdSlot,
  dataUri: string,
  mimeType: string,
): { html: string } | { error: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(processedHtml, 'text/html');

  // Build the creative element
  const creativeStyle = 'width:100%;height:100%;display:block;object-fit:contain;';
  let creativeInner: string;
  if (mimeType.startsWith('video/')) {
    creativeInner = `<video src="${dataUri}" style="${creativeStyle}" autoplay muted loop playsinline></video>`;
  } else if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    creativeInner = `<div style="${creativeStyle}background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;"><span style="color:#6366f1;font-family:monospace;font-size:14px;font-weight:bold;">HTML5</span><span style="color:#94a3b8;font-family:monospace;font-size:11px;margin-top:4px;">Rich Media Ad</span></div>`;
  } else {
    creativeInner = `<img src="${dataUri}" alt="Ad Creative" style="${creativeStyle}" />`;
  }
  const badge = `<div style="position:absolute;bottom:4px;right:4px;background:#000;color:#fff;font-family:monospace;font-size:10px;padding:2px 6px;letter-spacing:0.1em;text-transform:uppercase;z-index:9999;">Your Ad</div>`;
  const wrapped = `<div style="position:relative;width:${slot.width}px;height:${slot.height}px;overflow:hidden;outline:3px solid #000;flex-shrink:0;">${creativeInner}${badge}</div>`;

  const slotStyle =
    `position:relative;overflow:hidden;width:${slot.width}px;height:${slot.height}px;` +
    `max-width:${slot.width}px;max-height:${slot.height}px;display:block;flex-shrink:0;`;

  // Try recorded CSS selector + selectorIndex first
  let target: Element | null = null;
  if (slot.selector && slot.selector !== 'iab-dimension-match') {
    try {
      const matches = doc.querySelectorAll(slot.selector);
      target = matches[slot.selectorIndex ?? 0] ?? matches[0] ?? null;
    } catch { /* invalid selector */ }
  }

  // Fallback: find element with matching inline width/height style
  if (!target) {
    const candidates = doc.querySelectorAll('div,aside,section,ins');
    for (const el of Array.from(candidates)) {
      const s = el.getAttribute('style') ?? '';
      const wm = s.match(/width\s*:\s*(\d+)px/);
      const hm = s.match(/height\s*:\s*(\d+)px/);
      if (wm && hm) {
        if (Math.abs(parseInt(wm[1], 10) - slot.width) <= 12 &&
            Math.abs(parseInt(hm[1], 10) - slot.height) <= 12) {
          target = el;
          break;
        }
      }
    }
  }

  if (!target) return { error: 'Could not locate the ad slot element in the page HTML.' };

  (target as HTMLElement).setAttribute('style', slotStyle);
  target.innerHTML = wrapped;

  return { html: '<!DOCTYPE html>' + doc.documentElement.outerHTML };
}

// ---------------------------------------------------------------------------
// DomIframeView — scaled iframe with auto-scroll to slot position
// ---------------------------------------------------------------------------
function DomIframeView({ html, slot, pageHeight }: {
  html: string;
  slot: AdSlot;
  pageHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(PAGE_RENDER_WIDTH);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      setContainerWidth(w);
      setScale(w / PAGE_RENDER_WIDTH);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = Math.max(0, (slot.y - 160) * scale);
  }, [html, slot.y, scale]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--surface-2)]">
      <div className="relative" style={{ width: containerWidth, height: Math.max(pageHeight * scale, 400) }}>
        <iframe
          srcDoc={html}
          title="DOM preview"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: PAGE_RENDER_WIDTH,
            height: pageHeight || 4000,
            border: 'none',
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreviewPanel
// ---------------------------------------------------------------------------
interface PreviewPanelProps {
  slot: AdSlot | null;
  creative: Creative | null;
  detection: DetectionResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PreviewPanel({ slot, creative, detection, isOpen, onClose }: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('screenshot');

  // Screenshot tab state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // DOM tab state
  const [domHtml, setDomHtml] = useState<string | null>(null);
  const [domError, setDomError] = useState<string | null>(null);
  const [isLoadingDom, setIsLoadingDom] = useState(false);

  // Animation
  const [isClosing, setIsClosing] = useState(false);

  // Refs — hold cached data without triggering re-renders
  const processedHtmlRef = useRef<string | null>(null);
  const processedForUrlRef = useRef<string | null>(null); // tracks which detectedAt the cache is for
  const creativeBase64Ref = useRef<{ fileId: string; b64: string } | null>(null);
  const [creativeReady, setCreativeReady] = useState(false);

  // Close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 240);
  };

  // Esc key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // ---------------------------------------------------------------------------
  // Effect 1 — pre-process page HTML once per detection session
  // Keyed on detectedAt so a re-scan invalidates the cache.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!detection) return;
    if (processedForUrlRef.current === detection.detectedAt) return; // already processed
    processedHtmlRef.current = preprocessHtml(detection.pageHTML, detection.url);
    processedForUrlRef.current = detection.detectedAt;
  }, [detection?.detectedAt]);

  // ---------------------------------------------------------------------------
  // Effect 2 — fetch + cache creative base64
  // Runs on every panel open (isOpen) so we always have a fresh fetch if the
  // Vercel /tmp instance changed between upload and panel open.
  // Cache hit (same fileId + already have b64) skips the network call.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || !creative) return;

    // Cache hit — same creative already fetched this session
    if (creativeBase64Ref.current?.fileId === creative.fileId) {
      setCreativeReady(true);
      return;
    }

    setCreativeReady(false);
    setDomError(null);

    fetch(creative.tempUrl)
      .then(r => {
        if (!r.ok) throw new Error(`Could not load creative file (${r.status}).`);
        return r.blob();
      })
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(b64 => {
        creativeBase64Ref.current = { fileId: creative.fileId, b64 };
        setCreativeReady(true);
      })
      .catch(err => setDomError(err instanceof Error ? err.message : 'Could not load creative file.'));
  }, [isOpen, creative?.fileId]);

  // ---------------------------------------------------------------------------
  // Effect 3 — inject creative into pre-processed HTML per slot (synchronous)
  // Only runs when DOM tab is active + creative is cached + HTML is pre-processed.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || activeTab !== 'dom') return;
    if (!slot || !creative) return;
    if (!creativeReady || !creativeBase64Ref.current) return;
    if (!processedHtmlRef.current) return;

    setDomError(null);
    setDomHtml(null);
    setIsLoadingDom(true);

    const dataUri = `data:${creative.mimeType};base64,${creativeBase64Ref.current.b64}`;
    const result = injectCreativeIntoHtml(processedHtmlRef.current, slot, dataUri, creative.mimeType);

    if ('error' in result) {
      setDomError(result.error);
    } else {
      setDomHtml(result.html);
    }
    setIsLoadingDom(false);
  }, [isOpen, activeTab, slot?.id, creativeReady]);

  // ---------------------------------------------------------------------------
  // Screenshot effect — uses cached creative base64 from Effect 2
  // Waits for creativeReady so it never races the fetch.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || !slot || !creative || !detection) return;
    if (!creativeReady || !creativeBase64Ref.current) return;

    setPreview(null); setPreviewError(null); setIsLoadingPreview(true);

    fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creativeBase64: creativeBase64Ref.current.b64,
        creativeMimeType: creative.mimeType,
        slot,
        screenshotBase64: detection.screenshotBase64,
        pageWidth: detection.pageWidth,
        pageHeight: detection.pageHeight,
      }),
    })
      .then(r => r.json())
      .then(data => { if (data.error) setPreviewError(data.error); else setPreview(data); })
      .catch(() => setPreviewError('Failed to generate preview.'))
      .finally(() => setIsLoadingPreview(false));
  }, [isOpen, slot?.id, creative?.fileId, detection?.url, creativeReady]);

  if (!isOpen || !slot || !creative || !detection) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={handleClose} />

      {/* Panel */}
      <div className={`fixed inset-0 z-50 bg-white flex flex-col ${isClosing ? 'panel-close' : 'panel-open'}`}>
        {/* Top rule */}
        <div className="h-px w-full bg-black shrink-0" />

        {/* Header */}
        <div className="shrink-0 border-b border-black flex items-stretch">
          {/* Close */}
          <button
            onClick={handleClose}
            className="flex items-center gap-3 px-6 py-4 border-r border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="font-mono text-sm tracking-widest uppercase">Close</span>
            <span className="font-mono text-xs text-[var(--text-dim)] hidden sm:block">Esc</span>
          </button>

          {/* Slot info */}
          <div className="flex-1 px-6 py-4 flex items-center gap-6 min-w-0">
            <div className="min-w-0">
              <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-0.5">Ad Slot Preview</p>
              <p className="font-sans-ui text-base font-600 text-black truncate">
                {slot.iabName}
                <span className="font-mono font-400 text-[var(--text-muted)] ml-2">{slot.width}×{slot.height}px</span>
              </p>
            </div>
            <div className="hidden md:block h-8 w-px bg-[var(--line)]" />
            <p className="hidden md:block font-mono text-sm text-[var(--text-muted)] truncate max-w-xs">{detection.url}</p>
          </div>

          {/* Tab switcher */}
          <div className="flex shrink-0 border-l border-[var(--line)]">
            {(['screenshot', 'dom'] as ActiveTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-8 py-4 font-mono text-sm tracking-widest uppercase transition-colors border-r border-[var(--line)] last:border-r-0"
                style={{
                  background: activeTab === tab ? '#000' : '#fff',
                  color: activeTab === tab ? '#fff' : '#666',
                }}
              >
                {tab === 'screenshot' ? 'Screenshot' : 'DOM Preview'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* Screenshot tab */}
          {activeTab === 'screenshot' && (
            <div className="flex-1 overflow-auto">
              {isLoadingPreview ? (
                <div className="flex flex-col items-center justify-center gap-6 py-32">
                  <div className="relative w-16 h-px bg-[var(--line)] overflow-visible">
                    <div className="scan-line" />
                  </div>
                  <p className="font-mono text-sm tracking-widest uppercase text-[var(--text-muted)]">Compositing creative…</p>
                </div>
              ) : previewError ? (
                <div className="flex flex-col items-center gap-4 py-24 max-w-md mx-auto text-center">
                  <p className="font-serif text-2xl text-black">Preview failed</p>
                  <p className="font-sans-ui text-base text-[var(--text-muted)]">{previewError}</p>
                </div>
              ) : preview ? (
                <div>
                  <div className="border-b border-[var(--line)]">
                    <img
                      src={`data:image/png;base64,${preview.compositeImageBase64}`}
                      alt="Preview"
                      className="w-full block"
                    />
                  </div>
                  <div className="px-8 py-6 border-b border-[var(--line)] flex items-center gap-6">
                    <div className="w-12 h-12 border border-[var(--line)] overflow-hidden bg-[var(--surface-2)] shrink-0">
                      {(creative.fileType === 'image' || creative.fileType === 'gif') && (
                        <img src={creative.tempUrl} alt="" className="w-full h-full object-contain" />
                      )}
                    </div>
                    <div>
                      <p className="font-sans-ui text-base font-600 text-black">{creative.fileName}</p>
                      <p className="font-mono text-sm text-[var(--text-muted)] mt-0.5">
                        Previewed in {slot.iabName} slot — {slot.width}×{slot.height}px at position ({slot.x}, {slot.y})
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* DOM tab */}
          {activeTab === 'dom' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {isLoadingDom ? (
                <div className="flex flex-col items-center justify-center gap-6 py-32">
                  <div className="relative w-16 h-px bg-[var(--line)] overflow-visible">
                    <div className="scan-line" />
                  </div>
                  <p className="font-mono text-sm tracking-widest uppercase text-[var(--text-muted)]">Injecting creative into DOM…</p>
                </div>
              ) : domError ? (
                <div className="flex flex-col items-center gap-4 py-24 max-w-md mx-auto text-center">
                  <p className="font-serif text-2xl text-black">DOM preview failed</p>
                  <p className="font-sans-ui text-base text-[var(--text-muted)]">{domError}</p>
                  <button
                    onClick={() => { setDomHtml(null); setDomError(null); }}
                    className="btn-primary"
                  >
                    Retry
                  </button>
                </div>
              ) : domHtml ? (
                <DomIframeView
                  html={domHtml}
                  slot={slot}
                  pageHeight={detection.pageHeight}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
