'use client';

import { AdSlot } from '@/types';

interface SlotGridProps {
  slots: AdSlot[];
  onSelectSlot: (slot: AdSlot) => void;
  selectedSlotId?: string;
  emptyMessage?: string;
  emptySubMessage?: string;
}

function SlotVisual({ width, height }: { width: number; height: number }) {
  const ratio = width / height;
  const MAX = 36;
  let w: number, h: number;
  if (ratio >= 1) { w = MAX; h = Math.max(8, Math.round(MAX / ratio)); }
  else { h = MAX; w = Math.max(8, Math.round(MAX * ratio)); }
  return (
    <div className="flex items-center justify-center" style={{ width: MAX + 4, height: MAX + 4 }}>
      <div className="border border-black bg-[var(--surface-2)]" style={{ width: w, height: h }} />
    </div>
  );
}

export default function SlotGrid({ slots, onSelectSlot, selectedSlotId, emptyMessage, emptySubMessage }: SlotGridProps) {
  if (slots.length === 0) {
    return (
      <div className="border border-[var(--line)] py-20 text-center">
        <p className="font-serif text-2xl text-[var(--text-muted)] italic mb-2">
          {emptyMessage ?? 'No ad slots detected'}
        </p>
        <p className="font-mono text-sm text-[var(--text-dim)]">
          {emptySubMessage ?? 'Try a news or media website with display advertising.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {slots.map((slot, i) => {
        const isSelected = selectedSlotId === slot.id;
        return (
          <button
            key={slot.id}
            onClick={() => onSelectSlot(slot)}
            className="animate-slot-in group border border-[var(--line)] hover:border-black p-6 text-left transition-colors hover:bg-black hover:text-white"
            style={{
              animationDelay: `${i * 40}ms`,
              background: isSelected ? '#000' : '#fff',
              color: isSelected ? '#fff' : '#000',
            }}
          >
            {/* Top row: shape visual + selected tick */}
            <div className="flex items-start justify-between mb-5">
              <div
                className="border flex items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderColor: isSelected ? 'rgba(255,255,255,0.4)' : 'var(--line)',
                  background: isSelected ? 'rgba(255,255,255,0.08)' : 'var(--surface-2)',
                }}
              >
                <SlotVisual width={slot.width} height={slot.height} />
              </div>
              {isSelected && (
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </div>

            {/* IAB name */}
            <p className={`font-mono text-xs tracking-widest uppercase mb-1 ${isSelected ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
              {slot.iabName}
            </p>

            {/* Dimensions — big */}
            <p className="font-serif text-3xl leading-none mb-1">
              {slot.width}
              <span className={`text-xl mx-1 ${isSelected ? 'text-white/50' : 'text-[var(--text-dim)]'}`}>×</span>
              {slot.height}
            </p>
            <p className={`font-mono text-xs mb-4 ${isSelected ? 'text-white/50' : 'text-[var(--text-muted)]'}`}>pixels</p>

            {/* Position */}
            <p className={`font-mono text-xs mb-4 ${isSelected ? 'text-white/40' : 'text-[var(--text-dim)]'}`}>
              x:{slot.x} y:{slot.y}
            </p>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mb-5">
              {slot.selector !== 'iab-dimension-match' && (
                <span className={`font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 border ${
                  isSelected ? 'border-white/30 text-white/60' : 'border-[var(--line)] text-[var(--text-muted)]'
                }`}>
                  Selector match
                </span>
              )}
              {!slot.isVisible && (
                <span className={`font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 border ${
                  isSelected ? 'border-white/30 text-white/50' : 'border-[var(--line)] text-[var(--text-dim)]'
                }`}>
                  Hidden
                </span>
              )}
            </div>

            {/* CTA */}
            <div className={`flex items-center gap-2 font-mono text-sm font-500 transition-opacity ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}>
              <span>Preview creative</span>
              <span>→</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
