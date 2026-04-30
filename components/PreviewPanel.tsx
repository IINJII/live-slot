"use client";

import { useEffect, useState, useCallback } from "react";
import { AdSlot, Creative, DetectionResult } from "@/types";

interface PreviewPanelProps {
  slot: AdSlot | null;
  creative: Creative | null;
  detection: DetectionResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PreviewPanel({
  slot,
  creative,
  detection,
  isOpen,
  onClose,
}: PreviewPanelProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 240);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const handleDownload = useCallback(() => {
    if (!slot?.compositeBase64 || !detection) return;
    setIsDownloading(true);
    try {
      const a = document.createElement("a");
      a.href = `data:image/jpeg;base64,${slot.compositeBase64}`;
      a.download = `liveslot-${new URL(detection.url).hostname}-${slot.width}x${slot.height}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setIsDownloading(false);
    }
  }, [slot, detection]);

  if (!isOpen || !slot || !creative || !detection) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={handleClose} />

      <div className={`fixed inset-0 z-50 bg-white flex flex-col ${isClosing ? "panel-close" : "panel-open"}`}>
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

          {/* Creative info */}
          <div className="hidden lg:flex items-center gap-3 px-6 border-l border-[var(--line)]">
            {(creative.fileType === "image" || creative.fileType === "gif") && (
              <div className="w-8 h-8 border border-[var(--line)] overflow-hidden bg-[var(--surface-2)] shrink-0">
                <img src={creative.tempUrl} alt="" className="w-full h-full object-contain" />
              </div>
            )}
            <span className="font-mono text-xs text-[var(--text-muted)] truncate max-w-[160px]">{creative.fileName}</span>
          </div>

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={!slot.compositeBase64 || isDownloading}
            className="flex items-center gap-2 px-6 border-l border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="font-mono text-sm tracking-widest uppercase hidden sm:block">
              {isDownloading ? "Saving…" : "Download"}
            </span>
          </button>
        </div>

        {/* Body — just the composite image */}
        <div className="flex-1 overflow-auto bg-[var(--surface-2)] flex items-start justify-center min-h-0">
          {slot.compositeBase64 ? (
            <img
              src={`data:image/jpeg;base64,${slot.compositeBase64}`}
              alt="Ad slot preview"
              className="block mx-auto max-w-full"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-32">
              <p className="font-mono text-sm tracking-widest uppercase text-[var(--text-muted)]">Preview unavailable</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
