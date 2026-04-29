'use client';

import { useEffect, useRef, useState } from 'react';
import { AdSlot, Creative, DetectionResult, PreviewResult } from '@/types';

const PAGE_RENDER_WIDTH = 1440;

type ActiveTab = 'screenshot' | 'dom';

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
    const obs = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setContainerWidth(w);
      setScale(w / PAGE_RENDER_WIDTH);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Auto-scroll to slot position once rendered
  useEffect(() => {
    if (!containerRef.current) return;
    const scrollTarget = Math.max(0, (slot.y - 160) * scale);
    containerRef.current.scrollTop = scrollTarget;
  }, [html, slot.y, scale]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--surface-2)]">
      <div
        className="relative"
        style={{ width: containerWidth, height: Math.max(pageHeight * scale, 400) }}
      >
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

interface PreviewPanelProps {
  slot: AdSlot | null;
  creative: Creative | null;
  detection: DetectionResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PreviewPanel({ slot, creative, detection, isOpen, onClose }: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('screenshot');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [domHtml, setDomHtml] = useState<string | null>(null);
  const [isLoadingDom, setIsLoadingDom] = useState(false);
  const [domError, setDomError] = useState<string | null>(null);

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

  // Load screenshot composite
  useEffect(() => {
    if (!isOpen || !slot || !creative || !detection) return;
    setPreview(null); setPreviewError(null); setIsLoadingPreview(true);

    fetch(creative.tempUrl)
      .then(r => {
        if (!r.ok) throw new Error('Could not fetch creative file.');
        return r.blob();
      })
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(creativeBase64 => fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creativeBase64,
          creativeMimeType: creative.mimeType,
          slot,
          screenshotBase64: detection.screenshotBase64,
          pageWidth: detection.pageWidth,
          pageHeight: detection.pageHeight,
        }),
      }))
      .then(r => r.json())
      .then(data => { if (data.error) setPreviewError(data.error); else setPreview(data); })
      .catch(() => setPreviewError('Failed to generate preview.'))
      .finally(() => setIsLoadingPreview(false));
  }, [isOpen, slot?.id, creative?.fileId, detection?.url]);

  // Reset DOM preview when slot changes
  useEffect(() => {
    setDomHtml(null);
    setDomError(null);
  }, [slot?.id]);

  // Load DOM-injected preview (lazy — only when DOM tab is active)
  useEffect(() => {
    if (!isOpen || activeTab !== 'dom' || !slot || !creative || !detection) return;
    if (domHtml || isLoadingDom) return;
    setDomError(null); setIsLoadingDom(true);

    fetch(creative.tempUrl)
      .then(r => {
        if (!r.ok) throw new Error('Could not fetch creative file.');
        return r.blob();
      })
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(creativeBase64 => fetch('/api/inject-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageHTML: detection.pageHTML,
          baseUrl: detection.url,
          slot,
          creativeBase64,
          creativeMimeType: creative.mimeType,
        }),
      }))
      .then(r => {
        if (!r.ok) return r.json().then((d: { error?: string }) => { throw new Error(d.error ?? 'Injection failed'); });
        return r.text();
      })
      .then(html => setDomHtml(html))
      .catch(err => setDomError(err instanceof Error ? err.message : 'DOM preview failed.'))
      .finally(() => setIsLoadingDom(false));
  }, [isOpen, activeTab, slot?.id, creative?.fileId, detection?.url]);

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
                    onClick={() => { setDomHtml(null); setDomError(null); setIsLoadingDom(false); }}
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
