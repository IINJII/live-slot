"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone, Tablet, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { Creative, UploadResult } from "@/types";
import FramePicker from "@/components/FramePicker";

const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/zip",
  "application/x-zip-compressed",
  "text/html",
];

// Extension fallback — browsers sometimes send an empty/odd MIME for .zip/.html.
const ACCEPTED_EXTS = [".zip", ".html", ".htm"];

const VAST_EXTS = [".vast", ".xml"];
const VAST_MIMES = ["text/xml", "application/xml"];

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export default function Home() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [creative, setCreative] = useState<Creative | null>(null);
  const [url, setUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [urlTouched, setUrlTouched] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [device, setDevice] = useState<"mobile" | "tablet" | "desktop">(
    "desktop",
  );
  const [uploadMode, setUploadMode] = useState<"image" | "video" | "html">(
    "image",
  );
  const [vastUrl, setVastUrl] = useState("");
  const [framePicker, setFramePicker] = useState<{
    src: string;
    fileName: string;
    fileId: string;
  } | null>(null);

  // Pre-fill from sessionStorage on return
  useEffect(() => {
    try {
      const storedUrl = sessionStorage.getItem("ls_url");
      if (storedUrl) setUrl(storedUrl);
      const storedDevice = sessionStorage.getItem("ls_device") as
        | "mobile"
        | "tablet"
        | "desktop"
        | null;
      if (storedDevice) setDevice(storedDevice);

      const storedFileId = sessionStorage.getItem("ls_fileId");
      const storedFileName = sessionStorage.getItem("ls_fileName");
      const storedFileType = sessionStorage.getItem("ls_fileType");
      const storedMime = sessionStorage.getItem("ls_mimeType");
      const storedW = sessionStorage.getItem("ls_width");
      const storedH = sessionStorage.getItem("ls_height");
      const storedSize = sessionStorage.getItem("ls_size");

      if (storedFileId && storedFileName && storedFileType && storedMime) {
        setCreative({
          fileId: storedFileId,
          fileName: storedFileName,
          fileType: storedFileType as Creative["fileType"],
          mimeType: storedMime,
          width: Number(storedW ?? 0),
          height: Number(storedH ?? 0),
          tempUrl: `/api/serve/${storedFileId}`,
          size: Number(storedSize ?? 0),
        });
      }
    } catch {}
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);

    // VAST / XML — parse server-side to extract video URL
    const isVast =
      VAST_MIMES.includes(file.type) ||
      VAST_EXTS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (isVast) {
      setIsUploading(true);
      try {
        const vastXml = await file.text();
        const res = await fetch("/api/parse-vast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vastXml }),
        });
        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.error || "Failed to parse VAST");
          return;
        }
        setFramePicker({
          src: data.videoUrl,
          fileName: data.fileName,
          fileId: data.fileId,
        });
      } catch {
        setUploadError("Failed to parse VAST file.");
      } finally {
        setIsUploading(false);
      }
      return;
    }

    const nameLower = file.name.toLowerCase();
    if (
      !ACCEPTED_MIME.includes(file.type) &&
      !ACCEPTED_EXTS.some((ext) => nameLower.endsWith(ext))
    ) {
      setUploadError(
        "Unsupported format. Accepted: JPG PNG GIF WebP MP4 WebM ZIP HTML VAST",
      );
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("File exceeds 50 MB limit.");
      return;
    }

    // Video — upload to server so FFmpeg can extract frames server-side
    if (file.type === "video/mp4" || file.type === "video/webm") {
      setIsUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data: UploadResult & { error?: string } = await res.json();
        if (!res.ok || data.error) {
          setUploadError(data.error ?? "Upload failed");
          return;
        }
        setFramePicker({
          src: data.tempUrl,
          fileName: file.name,
          fileId: data.fileId,
        });
      } catch {
        setUploadError("Upload failed. Please try again.");
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // Image / HTML5 ZIP — upload normally
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data: UploadResult & { error?: string } = await res.json();
      if (!res.ok || data.error) {
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      setCreative({
        fileId: data.fileId,
        fileName: data.fileName,
        fileType: data.fileType,
        mimeType: data.mimeType,
        width: data.width,
        height: data.height,
        tempUrl: data.tempUrl,
        size: data.size,
      });
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleVastFetch = useCallback(async () => {
    if (!vastUrl) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const res = await fetch("/api/parse-vast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: vastUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Failed to process VAST");
        return;
      }
      setFramePicker({
        src: data.videoUrl,
        fileName: data.fileName,
        fileId: data.fileId,
      });
    } catch {
      setUploadError("Failed to fetch VAST. Check the URL and try again.");
    } finally {
      setIsUploading(false);
    }
  }, [vastUrl]);

  const handleFrameSelected = useCallback(
    async (blob: Blob, width: number, height: number) => {
      const fp = framePicker;
      setFramePicker(null);
      setIsUploading(true);
      try {
        const frameName = (fp?.fileName ?? "frame").replace(
          /\.(mp4|webm)$/i,
          "-frame.jpg",
        );
        const fd = new FormData();
        fd.append("file", blob, frameName);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data: UploadResult & { error?: string } = await res.json();
        if (!res.ok || data.error) {
          setUploadError(data.error ?? "Frame upload failed");
          return;
        }
        setCreative({
          fileId: data.fileId,
          fileName: frameName,
          fileType: "video",
          mimeType: "image/jpeg",
          width,
          height,
          tempUrl: data.tempUrl,
          size: blob.size,
        });
      } catch {
        setUploadError("Frame upload failed. Please try again.");
      } finally {
        setIsUploading(false);
      }
    },
    [framePicker],
  );

  const handleFrameCancelled = useCallback(() => {
    if (!framePicker) return;
    setFramePicker(null);
  }, [framePicker]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isUploading) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [isUploading, handleFile],
  );

  const clearCreative = () => {
    if (creative) {
      fetch("/api/cleanup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: creative.fileId }),
      }).catch(() => {});
      sessionStorage.removeItem("ls_fileId");
      sessionStorage.removeItem("ls_fileName");
      sessionStorage.removeItem("ls_fileType");
      sessionStorage.removeItem("ls_mimeType");
      sessionStorage.removeItem("ls_width");
      sessionStorage.removeItem("ls_height");
      sessionStorage.removeItem("ls_size");
    }
    setCreative(null);
  };

  const isValidUrl = (() => {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  })();

  const canSubmit = !!creative && isValidUrl && !isNavigating;

  const handleDetect = () => {
    if (!canSubmit || !creative) return;
    setIsNavigating(true);
    try {
      sessionStorage.setItem("ls_fileId", creative.fileId);
      sessionStorage.setItem("ls_fileName", creative.fileName);
      sessionStorage.setItem("ls_fileType", creative.fileType);
      sessionStorage.setItem("ls_mimeType", creative.mimeType);
      sessionStorage.setItem("ls_width", String(creative.width));
      sessionStorage.setItem("ls_height", String(creative.height));
      sessionStorage.setItem("ls_size", String(creative.size));
      sessionStorage.setItem("ls_url", url);
      sessionStorage.setItem("ls_device", device);
    } catch {}
    router.push(
      `/results?fileId=${encodeURIComponent(creative.fileId)}&url=${encodeURIComponent(url)}&device=${device}`,
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top rule */}
      <div className="h-px w-full bg-black" />

      {/* Nav */}
      <nav className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-2xl text-black">LiveSlot</span>
          <span className="font-mono text-xs text-[var(--text-muted)] tracking-widest uppercase hidden sm:block">
            Ad Preview Platform
          </span>
        </div>
        <span className="font-mono text-xs text-[var(--text-dim)] tracking-wider uppercase">
          Campaign Setup
        </span>
      </nav>

      {/* Main */}
      <main className="flex-1 flex flex-col justify-center px-6 py-16 max-w-5xl mx-auto w-full">
        {/* Headline */}
        <div className="mb-16 animate-fade-up">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-[var(--text-muted)] mb-4">
            Step 1 of 2
          </p>
          <h1 className="font-serif text-6xl sm:text-7xl text-black leading-[1.05] mb-6">
            Set up your
            <br />
            <span className="italic">campaign preview.</span>
          </h1>
          <p className="font-sans-ui text-lg text-[var(--text-secondary)] max-w-xl leading-relaxed">
            Upload your ad creative and enter the URL of the website you want to
            preview it on. We&apos;ll find every available ad slot
            automatically.
          </p>
        </div>

        {/* Two-column form */}
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-0 border border-black animate-fade-up"
          style={{ animationDelay: "0.1s" }}
        >
          {/* Left: Upload */}
          <div className="border-b lg:border-b-0 lg:border-r border-black p-8">
            <div className="mb-6">
              <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-1">
                Creative
              </p>
              <p className="font-sans-ui text-xl font-600 text-black">
                Upload your ad file
              </p>
            </div>

            {/* Mode tabs — only show when no creative selected */}
            {!creative && (
              <div className="flex border border-black mb-5">
                {(["image", "video", "html"] as const).map((mode, i) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setUploadMode(mode);
                      setUploadError(null);
                    }}
                    className={`cursor-pointer flex-1 py-2 font-mono text-xs tracking-widest uppercase transition-colors ${i > 0 ? "border-l border-black" : ""} ${
                      uploadMode === mode
                        ? "bg-black text-white"
                        : "bg-white text-black hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    {mode === "image"
                      ? "Image"
                      : mode === "video"
                        ? "Video"
                        : "HTML"}
                  </button>
                ))}
              </div>
            )}

            {creative ? (
              <div className="animate-fade-in">
                <div className="border border-[var(--line)] p-4 flex items-start gap-4 mb-4">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 shrink-0 bg-[var(--surface-2)] border border-[var(--line)] overflow-hidden flex items-center justify-center">
                    {creative.mimeType.startsWith("image/") ? (
                      <img
                        src={creative.tempUrl}
                        alt=""
                        className="w-full h-full object-contain"
                      />
                    ) : creative.mimeType.startsWith("video/") ? (
                      <video
                        src={creative.tempUrl}
                        className="w-full h-full object-contain"
                        muted
                        playsInline
                      />
                    ) : (
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        ZIP
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-sans-ui text-base font-600 text-black truncate">
                      {creative.fileName}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1.5">
                      <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        {creative.fileType}
                      </span>
                      {creative.width > 0 && (
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          {creative.width}×{creative.height}
                        </span>
                      )}
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {formatBytes(creative.size)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={clearCreative}
                    className="shrink-0 text-[var(--text-muted)] hover:text-black transition-colors p-1"
                    title="Remove"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <p className="font-mono text-xs text-black flex items-center gap-2">
                  <span>✓</span> Creative ready
                </p>
              </div>
            ) : uploadMode === "image" ? (
              /* Image dropzone */
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && inputRef.current?.click()}
                  className={`border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-4 py-12 px-8 text-center transition-colors bg-[var(--surface-1)] ${
                    isDragging
                      ? "border-black bg-[var(--surface-2)]"
                      : "border-black/30 hover:border-black hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {isUploading ? (
                    <>
                      <div
                        className="w-8 h-8 border border-black border-t-transparent animate-spin"
                        style={{ borderRadius: 0 }}
                      />
                      <span className="font-mono text-sm text-[var(--text-muted)] tracking-wider uppercase">
                        Uploading…
                      </span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-8 h-8 text-[var(--text-muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                        />
                      </svg>
                      <div>
                        <p className="font-sans-ui text-base text-black font-500">
                          Drop file here or click to browse
                        </p>
                        <p className="font-mono text-xs text-[var(--text-muted)] mt-2 tracking-wider uppercase">
                          JPG · PNG · GIF · WebP
                        </p>
                        <p className="font-mono text-xs text-[var(--text-dim)] mt-1">
                          Max 50 MB
                        </p>
                      </div>
                    </>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-3 font-mono text-sm text-red-600">
                    {uploadError}
                  </p>
                )}
              </div>
            ) : uploadMode === "video" ? (
              /* Video dropzone + VAST URL */
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && inputRef.current?.click()}
                  className={`border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-4 py-10 px-8 text-center transition-colors bg-[var(--surface-1)] ${
                    isDragging
                      ? "border-black bg-[var(--surface-2)]"
                      : "border-black/30 hover:border-black hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {isUploading ? (
                    <>
                      <div
                        className="w-8 h-8 border border-black border-t-transparent animate-spin"
                        style={{ borderRadius: 0 }}
                      />
                      <span className="font-mono text-sm text-[var(--text-muted)] tracking-wider uppercase">
                        Uploading…
                      </span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-8 h-8 text-[var(--text-muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                        />
                      </svg>
                      <div>
                        <p className="font-sans-ui text-base text-black font-500">
                          Drop file here or click to browse
                        </p>
                        <p className="font-mono text-xs text-[var(--text-muted)] mt-2 tracking-wider uppercase">
                          MP4 · WebM · VAST · XML
                        </p>
                        <p className="font-mono text-xs text-[var(--text-dim)] mt-1">
                          Max 50 MB
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* VAST URL secondary option */}
                <div className="mt-4 border-t border-[var(--line)] pt-4">
                  <p className="font-mono text-xs text-[var(--text-muted)] mb-2 tracking-wider uppercase">
                    Or paste a VAST URL
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={vastUrl}
                      onChange={(e) => setVastUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleVastFetch();
                      }}
                      placeholder="https://ad-server.com/vast?..."
                      className="input-field flex-1"
                      disabled={isUploading}
                    />
                    <button
                      type="button"
                      onClick={handleVastFetch}
                      disabled={!vastUrl || isUploading}
                      className="btn-primary shrink-0"
                    >
                      {isUploading ? (
                        <span
                          className="w-4 h-4 border border-white border-t-transparent animate-spin"
                          style={{ borderRadius: 0 }}
                        />
                      ) : (
                        "Fetch →"
                      )}
                    </button>
                  </div>
                </div>

                {uploadError && (
                  <p className="mt-3 font-mono text-sm text-red-600">
                    {uploadError}
                  </p>
                )}
              </div>
            ) : (
              /* HTML5 dropzone */
              <div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && inputRef.current?.click()}
                  className={`border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-4 py-12 px-8 text-center transition-colors bg-[var(--surface-1)] ${
                    isDragging
                      ? "border-black bg-[var(--surface-2)]"
                      : "border-black/30 hover:border-black hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {isUploading ? (
                    <>
                      <div
                        className="w-8 h-8 border border-black border-t-transparent animate-spin"
                        style={{ borderRadius: 0 }}
                      />
                      <span className="font-mono text-sm text-[var(--text-muted)] tracking-wider uppercase">
                        Rendering…
                      </span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-8 h-8 text-[var(--text-muted)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                        />
                      </svg>
                      <div>
                        <p className="font-sans-ui text-base text-black font-500">
                          Drop HTML5 creative here or click to browse
                        </p>
                        <p className="font-mono text-xs text-[var(--text-muted)] mt-2 tracking-wider uppercase">
                          ZIP · HTML
                        </p>
                        <p className="font-mono text-xs text-[var(--text-dim)] mt-1">
                          Reads IAB ad.size · Max 50 MB
                        </p>
                      </div>
                    </>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-3 font-mono text-sm text-red-600">
                    {uploadError}
                  </p>
                )}
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={
                uploadMode === "image"
                  ? ".jpg,.jpeg,.png,.webp,.gif"
                  : uploadMode === "video"
                    ? ".mp4,.webm,.vast,.xml"
                    : ".zip,.html,.htm"
              }
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>

          {/* Right: URL + Submit */}
          <div className="p-8 flex flex-col justify-between gap-8">
            <div>
              <div className="mb-6">
                <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-1">
                  Target
                </p>
                <p className="font-sans-ui text-xl font-600 text-black">
                  Enter website URL
                </p>
              </div>

              <div>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setUrlTouched(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) handleDetect();
                  }}
                  onBlur={() => setUrlTouched(true)}
                  placeholder="https://example.com"
                  className={`input-field ${urlTouched && url && !isValidUrl ? "error" : ""}`}
                />
                {urlTouched && url && !isValidUrl && (
                  <p className="mt-2 font-mono text-sm text-red-600">
                    Enter a valid URL starting with https://
                  </p>
                )}
              </div>

              <div className="mt-6 border-t border-[var(--line)] pt-6">
                <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-3">
                  Device
                </p>
                <div className="grid grid-cols-3 border border-black">
                  {(
                    [
                      { id: "mobile", label: "Mobile", Icon: Smartphone },
                      { id: "tablet", label: "Tablet", Icon: Tablet },
                      { id: "desktop", label: "Desktop", Icon: Monitor },
                    ] as const
                  ).map(({ id, label, Icon }, i) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDevice(id)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 transition-colors font-mono cursor-pointer ${i < 2 ? "border-r border-black" : ""} ${
                        device === id
                          ? "bg-black text-white"
                          : "bg-white text-black hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      <Icon size={18} strokeWidth={1.5} />
                      <span className="text-[10px] tracking-widest uppercase">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <button
                onClick={handleDetect}
                disabled={!canSubmit}
                className="btn-primary w-full text-base py-4"
              >
                {isNavigating ? (
                  <>
                    <span
                      className="w-4 h-4 border border-white border-t-transparent animate-spin"
                      style={{ borderRadius: 0 }}
                    />
                    Starting scan…
                  </>
                ) : (
                  <>Detect Ad Slots →</>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <div className="h-px w-full bg-[var(--line)]" />
      <footer className="px-6 py-4 flex items-center justify-between border-t border-transparent">
        <span className="font-mono text-xs text-[var(--text-dim)] tracking-widest uppercase">
          LiveSlot
        </span>
        <span className="font-mono text-xs text-[var(--text-dim)]">
          Ad Creative Preview Platform
        </span>
      </footer>

      {/* Frame picker overlay — shown when user uploads a video or fetches VAST */}
      {framePicker && (
        <FramePicker
          videoSrc={framePicker.src}
          fileName={framePicker.fileName}
          fileId={framePicker.fileId}
          onSelect={handleFrameSelected}
          onCancel={handleFrameCancelled}
        />
      )}
    </div>
  );
}
