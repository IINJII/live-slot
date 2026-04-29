'use client';

import { useEffect, useRef, useState } from 'react';
import { AdSlot, Creative, DetectionResult, PreviewResult } from '@/types';

const PAGE_RENDER_WIDTH = 1440;

type ActiveTab = 'screenshot' | 'live';

function LiveIframeView({
  iframeRef, detection, slot, creative, iframeLoaded, onLoad, onError,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  detection: DetectionResult;
  slot: AdSlot;
  creative: Creative;
  iframeLoaded: boolean;
  onLoad: () => void;
  onError: () => void;
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

  useEffect(() => {
    if (!iframeLoaded || !containerRef.current) return;
    containerRef.current.scrollTop = Math.max(0, (slot.y - 160) * scale);
  }, [iframeLoaded, slot.y, scale]);

  const slotL = slot.x * scale;
  const slotT = slot.y * scale;
  const slotW = slot.width * scale;
  const slotH = slot.height * scale;

  return (
    <div className="h-full flex flex-col">
      {/* Info bar */}
      <div className="shrink-0 border-b border-[var(--line)] px-6 py-3 flex items-center gap-4">
        <div className="w-2 h-2 bg-black animate-pulse" />
        <span className="font-mono text-sm text-[var(--text-secondary)]">
          Live embed — your creative outlined in black at the detected slot position
        </span>
      </div>

      {/* Iframe container */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--surface-2)]">
        <div className="relative" style={{ width: containerWidth, height: Math.max((detection.pageHeight || 4000) * scale, 400) }}>
          {/* Creative overlay */}
          {iframeLoaded && (
            <div className="pointer-events-none absolute z-10" style={{ left: slotL, top: slotT, width: slotW, height: slotH }}>
              <div className="relative h-full w-full overflow-hidden" style={{ outline: '3px solid #000' }}>
                {(creative.fileType === 'image' || creative.fileType === 'gif') && (
                  <img src={creative.tempUrl} alt="Creative" className="w-full h-full" style={{ objectFit: 'fill' }} />
                )}
                {creative.fileType === 'video' && (
                  <video src={creative.tempUrl} className="w-full h-full" style={{ objectFit: 'fill' }} autoPlay muted loop playsInline />
                )}
                {creative.fileType === 'html5' && (
                  <div className="w-full h-full bg-black flex items-center justify-center font-mono text-sm text-white">HTML5 Ad</div>
                )}
                <div className="absolute bottom-0 right-0 bg-black px-2 py-1 font-mono text-[10px] font-600 uppercase tracking-widest text-white leading-none">
                  Your Ad
                </div>
              </div>
            </div>
          )}

          {/* Scaled iframe */}
          <iframe
            ref={iframeRef}
            src={detection.url}
            onLoad={onLoad}
            onError={onError}
            sandbox="allow-scripts allow-same-origin"
            title="Live preview"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: PAGE_RENDER_WIDTH,
              height: detection.pageHeight || 4000,
              border: 'none',
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
              pointerEvents: 'none',
            }}
          />

          {/* Loading overlay */}
          {!iframeLoaded && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90">
              <div className="text-center">
                <div className="w-6 h-6 border border-black border-t-transparent animate-spin mx-auto mb-4" style={{ borderRadius: 0 }} />
                <p className="font-mono text-sm text-[var(--text-muted)] tracking-widest uppercase">Loading website…</p>
              </div>
            </div>
          )}
        </div>
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
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Fetch the creative as base64 on the client, then send to screenshot API.
    // This avoids the /tmp isolation problem on Vercel serverless functions.
    fetch(creative.tempUrl)
      .then(r => {
        if (!r.ok) throw new Error('Could not fetch creative file.');
        return r.blob();
      })
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Strip the "data:<mime>;base64," prefix
          resolve(dataUrl.split(',')[1]);
        };
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

  // Iframe block detection
  useEffect(() => {
    if (!isOpen) return;
    setIframeBlocked(false); setIframeLoaded(false);
    iframeTimerRef.current = setTimeout(() => setIframeBlocked(true), 9000);
    return () => { if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current); };
  }, [isOpen, detection?.url]);

  const handleIframeLoad = () => {
    setIframeLoaded(true);
    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc || doc.body?.innerHTML === '') setIframeBlocked(true);
    } catch { setIframeBlocked(false); }
  };

  if (!isOpen || !slot || !creative || !detection) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={`fixed inset-0 z-50 bg-white flex flex-col ${isClosing ? 'panel-close' : 'panel-open'}`}
      >
        {/* Top rule */}
        <div className="h-px w-full bg-black shrink-0" />

        {/* Header */}
        <div className="shrink-0 border-b border-black flex items-stretch">
          {/* Close */}
          <button
            onClick={handleClose}
            className="flex items-center gap-3 px-6 py-4 border-r border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors group"
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
            {(['screenshot', 'live'] as ActiveTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-8 py-4 font-mono text-sm tracking-widest uppercase transition-colors border-r border-[var(--line)] last:border-r-0"
                style={{
                  background: activeTab === tab ? '#000' : '#fff',
                  color: activeTab === tab ? '#fff' : '#666',
                }}
              >
                {tab === 'screenshot' ? 'Screenshot' : 'Live Preview'}
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
                  {/* Composite image */}
                  <div className="border-b border-[var(--line)]">
                    <img
                      src={`data:image/png;base64,${preview.compositeImageBase64}`}
                      alt="Preview"
                      className="w-full block"
                    />
                  </div>

                  {/* Footer info */}
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

          {/* Live tab */}
          {activeTab === 'live' && (
            <div className="flex-1 min-h-0 flex flex-col">
              {iframeBlocked ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
                  <div>
                    <p className="font-serif text-3xl text-black text-center mb-3">Site blocks embedding</p>
                    <p className="font-sans-ui text-base text-[var(--text-muted)] text-center max-w-lg">
                      This website uses <code className="font-mono bg-[var(--surface-2)] px-1.5 py-0.5 text-sm">X-Frame-Options</code> or Content Security Policy headers that prevent iframe embedding. Use the Screenshot tab for a reliable render.
                    </p>
                  </div>
                  <button onClick={() => setActiveTab('screenshot')} className="btn-primary">
                    View Screenshot →
                  </button>
                </div>
              ) : (
                <LiveIframeView
                  iframeRef={iframeRef}
                  detection={detection}
                  slot={slot}
                  creative={creative}
                  iframeLoaded={iframeLoaded}
                  onLoad={handleIframeLoad}
                  onError={() => setIframeBlocked(true)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
