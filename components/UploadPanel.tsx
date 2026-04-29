'use client';

import { useCallback, useRef, useState } from 'react';
import { Creative, UploadResult } from '@/types';

interface UploadPanelProps {
  creative: Creative | null;
  onUpload: (creative: Creative) => void;
  onClear: () => void;
  disabled?: boolean;
}

const ACCEPTED_MIME = [
  'image/jpeg','image/png','image/webp','image/gif',
  'video/mp4','video/webm',
  'application/zip','application/x-zip-compressed',
];

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

export default function UploadPanel({ creative, onUpload, onClear, disabled }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (!ACCEPTED_MIME.includes(file.type)) {
      setError('Unsupported format. Accepted: JPG PNG GIF WebP MP4 WebM ZIP');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File exceeds 50 MB limit.');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data: UploadResult & { error?: string } = await res.json();
      if (!res.ok || data.error) { setError(data.error ?? 'Upload failed'); return; }
      onUpload({ fileId: data.fileId, fileName: data.fileName, fileType: data.fileType,
        mimeType: data.mimeType, width: data.width, height: data.height,
        tempUrl: data.tempUrl, size: data.size });
    } catch { setError('Upload failed. Try again.'); }
    finally { setIsUploading(false); }
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [disabled, isUploading, handleFile]);

  if (creative) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-4 rounded-lg border border-[var(--wire)] bg-[var(--surface-2)] p-4">
          {/* Thumbnail */}
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-[var(--wire)] bg-black">
            {(creative.fileType === 'image' || creative.fileType === 'gif') ? (
              <img src={creative.tempUrl} alt="" className="h-full w-full object-contain" />
            ) : creative.fileType === 'video' ? (
              <video src={creative.tempUrl} className="h-full w-full object-contain" muted playsInline />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center">
                <span className="font-mono-dm text-[10px] font-500 text-[var(--gold)]">HTML5</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate font-sora text-sm font-500 text-white">{creative.fileName}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-mono-dm text-[10px] uppercase tracking-wider text-[var(--gold)]">
                {creative.fileType}
              </span>
              {creative.width > 0 && (
                <span className="font-mono-dm text-[10px] text-[oklch(0.45_0.008_240)]">
                  {creative.width}×{creative.height}
                </span>
              )}
              <span className="font-mono-dm text-[10px] text-[oklch(0.45_0.008_240)]">
                {formatBytes(creative.size)}
              </span>
            </div>
          </div>

          <button
            onClick={onClear}
            disabled={disabled}
            className="shrink-0 rounded p-1.5 text-[oklch(0.4_0.005_240)] transition hover:text-white disabled:opacity-40"
            title="Remove"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Accepted indicator */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono-dm text-[10px] text-emerald-400/80 tracking-wider uppercase">Creative ready</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed py-10 transition-all duration-200 ${
          isDragging
            ? 'border-[var(--gold)] bg-[var(--gold-glow)]'
            : 'border-[oklch(0.25_0.005_240)] hover:border-[oklch(0.35_0.008_240)] hover:bg-[var(--surface-2)]'
        } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border border-[var(--gold)] border-t-transparent animate-spin" />
            </div>
            <span className="font-mono-dm text-[11px] tracking-widest uppercase text-[oklch(0.5_0.008_240)]">
              Uploading…
            </span>
          </div>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--wire)]">
              <svg className="h-5 w-5 text-[oklch(0.4_0.008_240)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-sora text-sm font-500 text-white">Drop file or click to browse</p>
              <p className="mt-1 font-mono-dm text-[10px] tracking-wider uppercase text-[oklch(0.4_0.008_240)]">
                JPG · PNG · GIF · WebP · MP4 · HTML5 ZIP
              </p>
            </div>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.zip"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        className="hidden" />
      {error && <p className="mt-2 font-mono-dm text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
