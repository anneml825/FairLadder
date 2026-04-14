'use client';

import { TimelineEvent } from '@/lib/types';

interface Props {
  events: TimelineEvent[];
}

const TYPE_CONFIG: Record<TimelineEvent['type'], { color: string; bg: string; icon: string; label: string }> = {
  layoff: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: '📉', label: 'Layoff' },
  funding: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: '💰', label: 'Funding' },
  leadership: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: '👤', label: 'Leadership' },
  lawsuit: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: '⚖️', label: 'Legal' },
  acquisition: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30', icon: '🤝', label: 'Acquisition' },
  rating: { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30', icon: '⭐', label: 'Rating' },
  pivot: { color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30', icon: '🔄', label: 'Pivot' },
  other: { color: 'text-[#8892a4]', bg: 'bg-[#1e2736] border-[#2a3448]', icon: '📌', label: 'News' },
};

export default function Timeline({ events }: Props) {
  if (!events || events.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-[#1e2736]">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Company Timeline</h3>
        <div className="text-center py-8 text-[#4a5568] text-sm">No timeline events found in available sources</div>
      </div>
    );
  }

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Company Timeline</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">{events.length} signals found</p>
        </div>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1e2736]" />

        <div className="space-y-4">
          {sorted.map((event, i) => {
            const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.other;
            return (
              <div key={i} className="relative flex gap-4 pl-8">
                {/* Dot */}
                <div className={`absolute left-2 top-2 w-4 h-4 rounded-full border flex items-center justify-center text-[8px] ${cfg.bg}`}>
                  {cfg.icon.slice(0, 1)}
                </div>

                <div className="flex-1 pb-4">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="text-xs text-[#4a5568] font-mono mt-0.5">{event.date}</span>
                  </div>
                  <h4 className="text-sm font-medium text-white mt-1">{event.title}</h4>
                  <p className="text-xs text-[#8892a4] mt-0.5 leading-relaxed">{event.description}</p>
                  {event.source && (
                    event.sourceUrl ? (
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-indigo-400/70 hover:text-indigo-300 mt-1 block underline underline-offset-2 transition-colors"
                      >
                        Source: {event.source.slice(0, 60)}
                      </a>
                    ) : (
                      <span className="text-[10px] text-[#4a5568] mt-1 block">Source: {event.source.slice(0, 60)}</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
