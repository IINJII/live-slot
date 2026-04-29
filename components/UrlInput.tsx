'use client';

import { useState } from 'react';

interface UrlInputProps {
  value: string;
  onChange: (val: string) => void;
  onDetect: () => void;
  isLoading: boolean;
  buttonDisabled?: boolean;
}

export default function UrlInput({ value, onChange, onDetect, isLoading, buttonDisabled }: UrlInputProps) {
  const [touched, setTouched] = useState(false);

  const isValid = (() => {
    try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch { return false; }
  })();

  const showError = touched && value.length > 0 && !isValid;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
          <svg className="h-3.5 w-3.5 text-[oklch(0.35_0.008_240)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        </div>
        <input
          type="url"
          value={value}
          onChange={(e) => { onChange(e.target.value); setTouched(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && isValid && !isLoading && !buttonDisabled) onDetect(); }}
          onBlur={() => setTouched(true)}
          placeholder="https://example.com"
          disabled={isLoading}
          className={`w-full rounded border bg-[var(--surface-2)] py-2.5 pl-9 pr-3 font-mono-dm text-sm text-white placeholder-[oklch(0.35_0.008_240)] outline-none transition-all duration-150 focus:ring-1 disabled:opacity-50 ${
            showError
              ? 'border-red-500/40 focus:ring-red-500/20'
              : 'border-[var(--wire)] focus:border-[var(--gold-dim)] focus:ring-[var(--gold-glow)]'
          }`}
        />
      </div>

      {showError && (
        <p className="font-mono-dm text-[10px] text-red-400">
          Enter a valid URL starting with https://
        </p>
      )}

      <button
        onClick={onDetect}
        disabled={!isValid || isLoading || !!buttonDisabled}
        className="btn-gold w-full rounded py-2.5 text-[13px]"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border border-black/30 border-t-black" />
            <span className="font-mono-dm tracking-widest uppercase text-[11px]">Scanning…</span>
          </span>
        ) : (
          <span className="font-mono-dm tracking-widest uppercase text-[11px]">
            Detect Ad Slots
          </span>
        )}
      </button>
    </div>
  );
}
