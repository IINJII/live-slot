'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AdSlot, Creative, DetectionResult } from '@/types';
import SlotGrid from '@/components/SlotGrid';
import PreviewPanel from '@/components/PreviewPanel';
import { ScanningState, SlotGridSkeleton } from '@/components/LoadingSkeleton';

type Step = 'scanning' | 'results' | 'error';

const SLOT_TOLERANCE = 15;

function filterCompatibleSlots(slots: AdSlot[], creative: Creative | null): AdSlot[] {
  if (!creative || creative.width === 0 || creative.height === 0) return slots;
  return slots.filter(
    (s) =>
      Math.abs(s.width - creative.width) <= SLOT_TOLERANCE &&
      Math.abs(s.height - creative.height) <= SLOT_TOLERANCE
  );
}

function CreativeThumb({ creative }: { creative: Creative }) {
  return (
    <div className="flex items-center gap-3 border border-[var(--line)] px-4 py-2.5">
      <div className="w-10 h-10 shrink-0 border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden flex items-center justify-center">
        {(creative.fileType === 'image' || creative.fileType === 'gif') ? (
          <img src={creative.tempUrl} alt="" className="w-full h-full object-contain" />
        ) : creative.fileType === 'video' ? (
          <video src={creative.tempUrl} className="w-full h-full object-contain" muted playsInline />
        ) : (
          <span className="font-mono text-[10px] text-[var(--text-muted)]">ZIP</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-sans-ui text-sm font-600 text-black truncate max-w-[180px]">{creative.fileName}</p>
        <p className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {creative.fileType}{creative.width > 0 ? ` · ${creative.width}×${creative.height}` : ''}
        </p>
      </div>
    </div>
  );
}

function ResultsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fileId = searchParams.get('fileId') ?? '';
  const targetUrl = searchParams.get('url') ?? '';
  const device = (searchParams.get('device') ?? 'desktop') as 'mobile' | 'tablet' | 'desktop';

  const [step, setStep] = useState<Step>('scanning');
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creative, setCreative] = useState<Creative | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AdSlot | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Restore creative from sessionStorage
  useEffect(() => {
    if (!fileId) return;
    try {
      const fileName = sessionStorage.getItem('ls_fileName') ?? 'Creative';
      const fileType = (sessionStorage.getItem('ls_fileType') ?? 'image') as Creative['fileType'];
      const mimeType = sessionStorage.getItem('ls_mimeType') ?? 'image/jpeg';
      const width = Number(sessionStorage.getItem('ls_width') ?? 0);
      const height = Number(sessionStorage.getItem('ls_height') ?? 0);
      const size = Number(sessionStorage.getItem('ls_size') ?? 0);
      setCreative({ fileId, fileName, fileType, mimeType, width, height, tempUrl: `/api/serve/${fileId}`, size });
    } catch {}
  }, [fileId]);

  // Run detection
  useEffect(() => {
    if (!fileId || !targetUrl) {
      setError('Missing creative or URL. Please go back and try again.');
      setStep('error');
      return;
    }

    // Read creative dims directly from sessionStorage — creative state may not be set yet
    const creativeWidth = Number(sessionStorage.getItem('ls_width') ?? 0);
    const creativeHeight = Number(sessionStorage.getItem('ls_height') ?? 0);

    setStep('scanning');
    fetch('/api/detect-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, creativeWidth, creativeHeight, fileId, device }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setStep('error'); return; }
        setDetection(data);
        setStep('results');
      })
      .catch(() => { setError('Could not reach the server. Please try again.'); setStep('error'); });
  }, [fileId, targetUrl, device]);

  const handleSelectSlot = (slot: AdSlot) => {
    setSelectedSlot(slot);
    setIsPanelOpen(true);
  };

  const handleBack = () => {
    router.push('/');
  };

  const handleRetry = () => {
    const creativeWidth = Number(sessionStorage.getItem('ls_width') ?? 0);
    const creativeHeight = Number(sessionStorage.getItem('ls_height') ?? 0);
    setStep('scanning');
    setError(null);
    setDetection(null);
    fetch('/api/detect-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, creativeWidth, creativeHeight, fileId, device }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setStep('error'); return; }
        setDetection(data); setStep('results');
      })
      .catch(() => { setError('Could not reach the server.'); setStep('error'); });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top rule */}
      <div className="h-px w-full bg-black shrink-0" />

      {/* Nav */}
      <nav className="shrink-0 border-b border-black flex items-stretch">
        {/* Back */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 px-6 py-4 border-r border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors font-mono text-sm tracking-widest uppercase"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          <span className="hidden sm:block">Back</span>
        </button>

        {/* Logo */}
        <div className="flex items-center px-6 border-r border-[var(--line)]">
          <span className="font-serif text-xl text-black">LiveSlot</span>
        </div>

        {/* Creative thumb */}
        <div className="flex items-center px-6 border-r border-[var(--line)]">
          {creative ? (
            <CreativeThumb creative={creative} />
          ) : (
            <div className="shimmer h-10 w-40" />
          )}
        </div>

        {/* URL */}
        <div className="flex-1 flex items-center px-6 min-w-0 border-r border-[var(--line)]">
          <p className="font-mono text-sm text-[var(--text-muted)] truncate">{targetUrl}</p>
        </div>

        {/* Step label */}
        <div className="flex items-center px-6">
          <span className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)]">Step 2 of 2</span>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col">

        {/* Section header */}
        <div className="border-b border-[var(--line)] px-8 py-8">
          {step === 'scanning' && (
            <div className="animate-fade-in">
              <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-2">Detecting</p>
              <h2 className="font-serif text-4xl sm:text-5xl text-black">Scanning for ad slots…</h2>
            </div>
          )}
          {step === 'results' && detection && (
            <div className="animate-fade-in flex items-end justify-between gap-6 flex-wrap">
              <div>
                <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-2">Results</p>
                {(() => {
                  const visibleSlots = filterCompatibleSlots(detection.slots, creative);
                  const isFiltered = creative && creative.width > 0 && creative.height > 0;
                  if (visibleSlots.length > 0) {
                    return (
                      <>
                        <h2 className="font-serif text-4xl sm:text-5xl text-black">
                          {visibleSlots.length} matching slot{visibleSlots.length !== 1 ? 's' : ''} <span className="italic">found.</span>
                        </h2>
                        {isFiltered && detection.slots.length !== visibleSlots.length && (
                          <p className="font-mono text-xs text-[var(--text-muted)] mt-2">
                            {visibleSlots.length} of {detection.slots.length} slots fit your creative ({creative!.width}×{creative!.height}px)
                          </p>
                        )}
                      </>
                    );
                  }
                  if (isFiltered && detection.slots.length > 0) {
                    return (
                      <h2 className="font-serif text-4xl sm:text-5xl text-black">
                        No matching slots <span className="italic">found.</span>
                      </h2>
                    );
                  }
                  return (
                    <h2 className="font-serif text-4xl sm:text-5xl text-black">
                      No ad slots <span className="italic">found.</span>
                    </h2>
                  );
                })()}
              </div>
              {(() => {
                const visibleSlots = filterCompatibleSlots(detection.slots, creative);
                return visibleSlots.length > 0 ? (
                  <p className="font-mono text-sm text-[var(--text-muted)]">Click any slot to preview your creative</p>
                ) : null;
              })()}
            </div>
          )}
          {step === 'error' && (
            <div className="animate-fade-in">
              <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-2">Error</p>
              <h2 className="font-serif text-4xl sm:text-5xl text-black italic">Detection failed.</h2>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 px-8 py-8">
          {step === 'scanning' && (
            <div>
              <ScanningState url={targetUrl} />
              <div className="mt-12">
                <SlotGridSkeleton count={6} />
              </div>
            </div>
          )}

          {step === 'error' && error && (
            <div className="max-w-xl">
              <div className="border border-black p-8 mb-6">
                <p className="font-sans-ui text-base text-black mb-6">{error}</p>
                <div className="flex gap-3">
                  <button onClick={handleRetry} className="btn-primary">Retry scan</button>
                  <button onClick={handleBack} className="btn-ghost">← Go back</button>
                </div>
              </div>
            </div>
          )}

          {step === 'results' && detection && (
            <div className="animate-fade-in">
              {(() => {
                const visibleSlots = filterCompatibleSlots(detection.slots, creative);
                const isFiltered = creative && creative.width > 0 && creative.height > 0;
                const noMatch = isFiltered && detection.slots.length > 0 && visibleSlots.length === 0;
                return (
                  <SlotGrid
                    slots={visibleSlots}
                    onSelectSlot={handleSelectSlot}
                    selectedSlotId={selectedSlot?.id}
                    emptyMessage={noMatch ? `No slots match ${creative!.width}×${creative!.height}px` : undefined}
                    emptySubMessage={noMatch ? `This page has ${detection.slots.length} slot${detection.slots.length !== 1 ? 's' : ''} but none fit your creative. Try a different site.` : undefined}
                  />
                );
              })()}

              {/* Footer actions */}
              <div className="mt-12 flex items-center justify-between border-t border-[var(--line)] pt-8">
                <button onClick={handleBack} className="btn-ghost">
                  ← Scan another site
                </button>
                {(() => {
                  const visibleSlots = filterCompatibleSlots(detection.slots, creative);
                  return visibleSlots.length > 0 ? (
                    <p className="font-mono text-sm text-[var(--text-muted)]">
                      {visibleSlots.length} slot{visibleSlots.length !== 1 ? 's' : ''} detected on{' '}
                      <span className="text-black">{new URL(targetUrl).hostname}</span>
                    </p>
                  ) : null;
                })()}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom rule */}
      <div className="h-px w-full bg-[var(--line)] shrink-0" />
      <footer className="px-6 py-4 flex items-center justify-between">
        <span className="font-mono text-xs text-[var(--text-dim)] tracking-widest uppercase">LiveSlot</span>
        <span className="font-mono text-xs text-[var(--text-dim)]">Ad Creative Preview Platform</span>
      </footer>

      {/* Preview panel */}
      <PreviewPanel
        slot={selectedSlot}
        creative={creative}
        detection={detection}
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
      />
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center font-mono text-sm text-[var(--text-muted)]">Loading…</div>}>
      <ResultsPageInner />
    </Suspense>
  );
}
