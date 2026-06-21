'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const FRAME_INTERVAL = 5;

interface Frame {
  src: string;
  timestamp: number;
  isManual?: boolean;
}

interface FramePickerProps {
  videoSrc: string;
  fileName: string;
  fileId: string;
  onSelect: (blob: Blob, width: number, height: number) => void;
  onCancel: () => void;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function FramePicker({ videoSrc, fileName, fileId, onSelect, onCancel }: FramePickerProps) {
  const playerVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [frames, setFrames] = useState<Frame[]>([]);
  const [isExtracting, setIsExtracting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Server-side frame extraction
  useEffect(() => {
    let cancelled = false;
    setIsExtracting(true);
    setError(null);
    setFrames([]);

    fetch('/api/extract-frames', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setFrames(
          (data.frames ?? []).map((f: { url: string; timestamp: number }) => ({
            src: f.url,
            timestamp: f.timestamp,
          }))
        );
      })
      .catch(() => { if (!cancelled) setError('Failed to extract frames from video.'); })
      .finally(() => { if (!cancelled) setIsExtracting(false); });

    return () => { cancelled = true; };
  }, [fileId]);

  // Attach player event listeners AFTER extraction completes (video only mounts then)
  useEffect(() => {
    if (isExtracting) return;
    const pv = playerVideoRef.current;
    if (!pv) return;

    // Sync initial state in case the video already has metadata
    if (isFinite(pv.duration) && pv.duration > 0) setDuration(pv.duration);
    setCurrentTime(pv.currentTime);
    setIsPlaying(!pv.paused);

    const onTime = () => setCurrentTime(pv.currentTime);
    const onMeta = () => { if (isFinite(pv.duration)) setDuration(pv.duration); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    pv.addEventListener('timeupdate', onTime);
    pv.addEventListener('loadedmetadata', onMeta);
    pv.addEventListener('durationchange', onMeta);
    pv.addEventListener('play', onPlay);
    pv.addEventListener('pause', onPause);

    return () => {
      pv.removeEventListener('timeupdate', onTime);
      pv.removeEventListener('loadedmetadata', onMeta);
      pv.removeEventListener('durationchange', onMeta);
      pv.removeEventListener('play', onPlay);
      pv.removeEventListener('pause', onPause);
    };
  }, [isExtracting]); // re-run once isExtracting flips to false so the video is in the DOM

  const togglePlay = () => {
    const pv = playerVideoRef.current;
    if (!pv) return;
    pv.paused ? pv.play() : pv.pause();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pv = playerVideoRef.current;
    if (pv) { pv.currentTime = Number(e.target.value); setCurrentTime(pv.currentTime); }
  };

  // Capture current frame — draw immediately, no rVFC needed (video is paused)
  const handleCapture = useCallback(() => {
    const pv = playerVideoRef.current;
    const c = canvasRef.current;
    if (!pv || !c || pv.videoWidth === 0) return;
    pv.pause();
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = pv.videoWidth;
    c.height = pv.videoHeight;
    ctx.drawImage(pv, 0, 0);
    setFrames(prev => [{
      src: c.toDataURL('image/jpeg', 0.88),
      timestamp: pv.currentTime,
      isManual: true,
    }, ...prev]);
  }, []);

  // Select frame → pass blob + dimensions to parent
  const handleSelect = useCallback(async (frame: Frame) => {
    const res = await fetch(frame.src);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const { width, height } = bmp;
    bmp.close();
    onSelect(blob, width, height);
  }, [onSelect]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <canvas ref={canvasRef} className="hidden" />

      <div className="h-px w-full bg-black shrink-0" />

      {/* Header */}
      <div className="shrink-0 border-b border-black flex items-stretch">
        <button
          onClick={onCancel}
          className="flex items-center gap-3 px-6 py-4 border-r border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="font-mono text-sm tracking-widest uppercase">Cancel</span>
        </button>
        <div className="flex-1 px-6 py-4 flex items-center min-w-0">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-0.5">
              Video Creative — {fileName}
            </p>
            <p className="font-sans-ui text-base font-600 text-black">
              {isExtracting
                ? 'Extracting frames…'
                : `${frames.length} frame${frames.length !== 1 ? 's' : ''} · 1 every ${FRAME_INTERVAL}s · click to use as your creative`}
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="font-mono text-sm text-red-600">{error}</p>
          <button onClick={onCancel} className="font-mono text-xs text-[var(--text-muted)] underline">Go back</button>
        </div>
      ) : isExtracting ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="w-8 h-8 border border-black border-t-transparent animate-spin" style={{ borderRadius: 0 }} />
          <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)]">
            Extracting frames…
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden" style={{ minHeight: 0 }}>

          {/* Player panel */}
          <div className="lg:w-72 lg:shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-[var(--line)]">
            {/* Video */}
            <div className="bg-black flex items-center justify-center" style={{ height: 220 }}>
              <video
                ref={playerVideoRef}
                src={videoSrc}
                className="max-w-full max-h-full object-contain"
                muted
                playsInline
                loop
              />
            </div>

            {/* Controls */}
            <div className="p-4 space-y-3 bg-white border-t border-[var(--line)]">
              {/* Seek bar */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[var(--text-muted)] w-10 text-right shrink-0">
                  {fmt(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  className="flex-1 accent-black h-1"
                />
                <span className="font-mono text-[10px] text-[var(--text-muted)] w-10 shrink-0">
                  {fmt(duration)}
                </span>
              </div>

              {/* Play + Capture */}
              <div className="flex gap-2">
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 border border-black flex items-center justify-center hover:bg-black hover:text-white transition-colors shrink-0"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleCapture}
                  className="flex-1 border border-black hover:bg-black hover:text-white transition-colors font-mono text-xs tracking-widest uppercase h-10 flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                  </svg>
                  Capture
                </button>
              </div>

              <p className="font-mono text-[10px] text-[var(--text-dim)] text-center leading-tight">
                Pause · click Capture to add that frame
              </p>
            </div>
          </div>

          {/* Frames grid */}
          <div className="flex-1 overflow-auto bg-[var(--surface-2)]" style={{ minWidth: 0 }}>
            <div className="p-4 sm:p-6">
              {frames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <p className="font-mono text-sm text-[var(--text-muted)]">No frames extracted.</p>
                  <p className="font-mono text-xs text-[var(--text-dim)]">Use the player to capture a frame manually.</p>
                </div>
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                  {frames.map((frame, i) => (
                    <button
                      key={`${frame.timestamp}-${i}`}
                      onClick={() => handleSelect(frame)}
                      className="group relative border border-[var(--line)] hover:border-black overflow-hidden transition-colors bg-white aspect-video"
                    >
                      <img src={frame.src} alt={`Frame at ${fmt(frame.timestamp)}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
                        <span className="font-mono text-xs text-white tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                          Use this
                        </span>
                      </div>
                      <span className="absolute bottom-1.5 left-1.5 font-mono text-[10px] bg-black/70 text-white px-1.5 py-0.5">
                        {fmt(frame.timestamp)}
                      </span>
                      {frame.isManual && (
                        <span className="absolute top-1.5 right-1.5 font-mono text-[10px] bg-black text-white px-1.5 py-0.5">
                          Manual
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
