"use client";

import { useEffect, useRef, useState } from "react";
import { AdSlot, Creative, DetectionResult } from "@/types";

// ---------------------------------------------------------------------------
// OverlayView — pixel-accurate creative overlay on top of the full-page screenshot.
// Uses the same (slot.x, slot.y) coordinates recorded during Puppeteer detection.
// No HTML re-rendering, no iframe, no selector lookup — works on every site.
// ---------------------------------------------------------------------------
function OverlayView({
  slot,
  creative,
  detection,
  creativeB64,
}: {
  slot: AdSlot;
  creative: Creative;
  detection: DetectionResult;
  creativeB64: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(0);

  // Compute scale whenever the screenshot image resizes
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const obs = new ResizeObserver(() => {
      if (img.naturalWidth > 0) {
        setScale(img.clientWidth / img.naturalWidth);
      }
    });
    obs.observe(img);
    if (img.complete && img.naturalWidth > 0) {
      setScale(img.clientWidth / img.naturalWidth);
    }
    return () => obs.disconnect();
  }, []);

  // Scroll so the slot is visible whenever slot or scale changes
  useEffect(() => {
    if (!containerRef.current || scale === 0) return;
    containerRef.current.scrollTop = Math.max(0, slot.y * scale - 160);
  }, [slot.id, scale]);

  const slotL = slot.x * scale;
  const slotT = slot.y * scale;
  const slotW = slot.width * scale;
  const slotH = slot.height * scale;

  const dataUri = `data:${creative.mimeType};base64,${creativeB64}`;

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[var(--surface-2)]">
      <div className="relative inline-block w-full">
        {/* Full-page screenshot as base */}
        <img
          ref={imgRef}
          src={`data:image/jpeg;base64,${detection.screenshotBase64}`}
          alt="Page screenshot"
          className="w-full block"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) setScale(img.clientWidth / img.naturalWidth);
          }}
        />

        {scale > 0 && (
          <>
            {/* Dashed slot border */}
            <div
              style={{
                position: "absolute",
                left: slotL,
                top: slotT,
                width: slotW,
                height: slotH,
                outline: "3px dashed #6366f1",
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            />

            {/* Creative overlay — clipped to slot bounds */}
            <div
              style={{
                position: "absolute",
                left: slotL,
                top: slotT,
                width: slotW,
                height: slotH,
                overflow: "hidden",
                background: "#e5e5e5",
                pointerEvents: "none",
              }}
            >
              {creative.mimeType.startsWith("video/") ? (
                <video
                  src={dataUri}
                  autoPlay
                  muted
                  loop
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              ) : creative.mimeType === "application/zip" ||
                creative.mimeType === "application/x-zip-compressed" ? (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "#0f172a",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 14, fontWeight: "bold" }}>
                    HTML5
                  </span>
                  <span style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 11, marginTop: 4 }}>
                    Rich Media Ad
                  </span>
                </div>
              ) : (
                <img
                  src={dataUri}
                  alt="Ad Creative"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              )}
            </div>

            {/* "Your Ad" badge */}
            <div
              style={{
                position: "absolute",
                left: slotL,
                top: slotT,
                background: "#000",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "2px 6px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                pointerEvents: "none",
                lineHeight: 1.6,
              }}
            >
              Your Ad
            </div>
          </>
        )}
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

export default function PreviewPanel({
  slot,
  creative,
  detection,
  isOpen,
  onClose,
}: PreviewPanelProps) {
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Cached creative base64 — fetched once per fileId
  const creativeBase64Ref = useRef<{ fileId: string; b64: string } | null>(null);
  const [creativeReady, setCreativeReady] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 240);
  };

  // Esc key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // ---------------------------------------------------------------------------
  // Fetch + cache creative base64
  // Runs on every panel open so we re-fetch if the Vercel /tmp instance changed.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || !creative) return;

    if (creativeBase64Ref.current?.fileId === creative.fileId) {
      setCreativeReady(true);
      return;
    }

    setCreativeReady(false);
    setOverlayError(null);

    fetch(creative.tempUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load creative file (${r.status}).`);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((b64) => {
        creativeBase64Ref.current = { fileId: creative.fileId, b64 };
        setCreativeReady(true);
      })
      .catch((err) =>
        setOverlayError(err instanceof Error ? err.message : "Could not load creative file."),
      );
  }, [isOpen, creative?.fileId]);

  if (!isOpen || !slot || !creative || !detection) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={handleClose} />

      {/* Panel */}
      <div
        className={`fixed inset-0 z-50 bg-white flex flex-col ${isClosing ? "panel-close" : "panel-open"}`}
      >
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
              <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-0.5">
                Ad Slot Preview
              </p>
              <p className="font-sans-ui text-base font-600 text-black truncate">
                {slot.iabName}
                <span className="font-mono font-400 text-[var(--text-muted)] ml-2">
                  {slot.width}×{slot.height}px
                </span>
              </p>
            </div>
            <div className="hidden md:block h-8 w-px bg-[var(--line)]" />
            <p className="hidden md:block font-mono text-sm text-[var(--text-muted)] truncate max-w-xs">
              {detection.url}
            </p>
          </div>

          {/* Creative info */}
          <div className="hidden lg:flex items-center gap-3 px-6 border-l border-[var(--line)]">
            {(creative.fileType === "image" || creative.fileType === "gif") && (
              <div className="w-8 h-8 border border-[var(--line)] overflow-hidden bg-[var(--surface-2)] shrink-0">
                <img src={creative.tempUrl} alt="" className="w-full h-full object-contain" />
              </div>
            )}
            <span className="font-mono text-xs text-[var(--text-muted)] truncate max-w-[160px]">
              {creative.fileName}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {!creativeReady ? (
            <div className="flex flex-col items-center justify-center gap-6 py-32">
              <div className="relative w-16 h-px bg-[var(--line)] overflow-visible">
                <div className="scan-line" />
              </div>
              <p className="font-mono text-sm tracking-widest uppercase text-[var(--text-muted)]">
                Loading creative…
              </p>
            </div>
          ) : overlayError ? (
            <div className="flex flex-col items-center gap-4 py-24 max-w-md mx-auto text-center">
              <p className="font-serif text-2xl text-black">Preview failed</p>
              <p className="font-sans-ui text-base text-[var(--text-muted)]">{overlayError}</p>
              <button
                onClick={() => {
                  setOverlayError(null);
                  setCreativeReady(false);
                  creativeBase64Ref.current = null;
                }}
                className="btn-primary"
              >
                Retry
              </button>
            </div>
          ) : creativeBase64Ref.current ? (
            <OverlayView
              slot={slot}
              creative={creative}
              detection={detection}
              creativeB64={creativeBase64Ref.current.b64}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
