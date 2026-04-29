export function SlotCardSkeleton() {
  return (
    <div className="border-r border-b border-black p-6">
      <div className="shimmer w-11 h-11 mb-5" />
      <div className="shimmer h-3 w-20 mb-2" />
      <div className="shimmer h-8 w-32 mb-1" />
      <div className="shimmer h-3 w-10 mb-4" />
      <div className="shimmer h-3 w-24 mb-5" />
      <div className="shimmer h-4 w-16" />
    </div>
  );
}

export function SlotGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-l border-t border-black">
      {Array.from({ length: count }).map((_, i) => (
        <SlotCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ScanningState({ url }: { url: string }) {
  const steps = [
    'Launching headless browser',
    'Loading page content',
    'Querying ad selectors',
    'Matching IAB dimensions',
    'Capturing screenshot',
  ];

  return (
    <div className="py-16 px-8 max-w-xl">
      {/* Animated scan indicator */}
      <div className="relative h-px w-full bg-[var(--line)] mb-12 overflow-visible">
        <div className="scan-line" />
      </div>

      <p className="font-mono text-xs tracking-widest uppercase text-[var(--text-muted)] mb-2">Scanning</p>
      <p className="font-serif text-2xl text-black mb-1 break-all">{url}</p>
      <p className="font-sans-ui text-sm text-[var(--text-muted)] mb-10">This may take up to 30 seconds.</p>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 bg-black animate-pulse shrink-0" style={{ animationDelay: `${i * 0.3}s` }} />
            <span className="font-mono text-sm text-[var(--text-secondary)]">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
