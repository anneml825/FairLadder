'use client';

import { Flag, GreenFlag } from '@/lib/types';

interface RedFlagProps {
  flags: Flag[];
}

interface GreenFlagProps {
  flags: GreenFlag[];
}

const SEVERITY_CONFIG = {
  critical: {
    bg: 'bg-red-500/8 hover:bg-red-500/12',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 border-red-500/40 text-red-400',
    title: 'text-red-300',
    label: 'CRITICAL',
    dot: 'bg-red-500',
  },
  watch: {
    bg: 'bg-amber-500/8 hover:bg-amber-500/12',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/20 border-amber-500/40 text-amber-400',
    title: 'text-amber-300',
    label: 'WATCH',
    dot: 'bg-amber-500',
  },
  minor: {
    bg: 'bg-[#1e2736]/50 hover:bg-[#1e2736]/80',
    border: 'border-[#2a3448]',
    badge: 'bg-[#2a3448] border-[#3a4458] text-[#8892a4]',
    title: 'text-[#c8d0e0]',
    label: 'MINOR',
    dot: 'bg-[#4a5568]',
  },
};

export function RedFlagCards({ flags }: RedFlagProps) {
  const criticals = flags.filter(f => f.severity === 'critical');
  const watches = flags.filter(f => f.severity === 'watch');
  const minors = flags.filter(f => f.severity === 'minor');
  const ordered = [...criticals, ...watches, ...minors];

  if (ordered.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-[#1e2736]">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Red Flags</h3>
        <div className="text-center py-6 text-emerald-400 text-sm">No significant red flags identified</div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Red Flags</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">{ordered.length} issues identified</p>
        </div>
        <div className="flex gap-2">
          {criticals.length > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 font-medium">
              {criticals.length} Critical
            </span>
          )}
          {watches.length > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 font-medium">
              {watches.length} Watch
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {ordered.map((flag, i) => {
          const cfg = SEVERITY_CONFIG[flag.severity];
          return (
            <div key={i} className={`p-4 rounded-xl border transition-all ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <span className="text-xl">{flag.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                      <span className={`w-1 h-1 rounded-full ${cfg.dot}`}></span>
                      {cfg.label}
                    </span>
                    <span className={`text-sm font-semibold ${cfg.title}`}>{flag.title}</span>
                  </div>
                  <p className="text-xs text-[#8892a4] leading-relaxed">{flag.explanation}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GreenFlagCards({ flags }: GreenFlagProps) {
  if (!flags || flags.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-[#1e2736]">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Green Flags</h3>
        <div className="text-center py-6 text-[#4a5568] text-sm italic">No significant green flags identified</div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Green Flags</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">{flags.length} genuine positives</p>
        </div>
      </div>

      <div className="space-y-3">
        {flags.map((flag, i) => (
          <div key={i} className="p-4 rounded-xl border bg-emerald-500/8 hover:bg-emerald-500/12 border-emerald-500/30 transition-all">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <span className="text-xl">{flag.icon}</span>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-emerald-300 mb-1">{flag.title}</h4>
                <p className="text-xs text-[#8892a4] leading-relaxed">{flag.explanation}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
