'use client';

import { useState } from 'react';

interface LanguageWarning {
  phrase: string;
  explanation: string;
  severity: 'red' | 'yellow' | 'grey';
}

interface Props {
  warnings: LanguageWarning[];
  jobText?: string;
}

const SEVERITY_CONFIG = {
  red: { bg: 'bg-red-500/15 border-red-500/40', text: 'text-red-300', hover: 'hover:bg-red-500/25' },
  yellow: { bg: 'bg-amber-500/15 border-amber-500/40', text: 'text-amber-300', hover: 'hover:bg-amber-500/25' },
  grey: { bg: 'bg-[#1e2736] border-[#2a3448]', text: 'text-[#8892a4]', hover: 'hover:bg-[#2a3448]' },
};

export default function LanguageChips({ warnings }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!warnings || warnings.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-[#1e2736]">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Language Warnings</h3>
        <div className="text-center py-4 text-emerald-400 text-sm">No warning phrases detected in posting</div>
      </div>
    );
  }

  const reds = warnings.filter(w => w.severity === 'red');
  const yellows = warnings.filter(w => w.severity === 'yellow');
  const greys = warnings.filter(w => w.severity === 'grey');
  const ordered = [...reds, ...yellows, ...greys];

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Language Warnings</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">Flagged phrases from job posting — click to see what they signal</p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-[#1e2736] border border-[#2a3448] text-[#8892a4]">
          {warnings.length} found
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {ordered.map((w, i) => {
          const cfg = SEVERITY_CONFIG[w.severity];
          const isOpen = expanded === i;
          return (
            <button
              key={i}
              onClick={() => setExpanded(isOpen ? null : i)}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer ${cfg.bg} ${cfg.text} ${cfg.hover}`}
            >
              &ldquo;{w.phrase}&rdquo;
              <span className="ml-1 opacity-60">{isOpen ? '▲' : '▼'}</span>
            </button>
          );
        })}
      </div>

      {/* Expanded explanation */}
      {expanded !== null && ordered[expanded] && (
        <div className={`mt-4 p-4 rounded-xl border transition-all ${SEVERITY_CONFIG[ordered[expanded].severity].bg}`}>
          <div className={`text-xs font-bold mb-2 uppercase ${SEVERITY_CONFIG[ordered[expanded].severity].text}`}>
            &ldquo;{ordered[expanded].phrase}&rdquo;
          </div>
          <p className="text-sm text-[#c8d0e0] leading-relaxed">{ordered[expanded].explanation}</p>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mt-4 pt-3 border-t border-[#1e2736]">
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          Major red flag
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          Worth noting
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          <span className="w-2 h-2 rounded-full bg-[#4a5568]"></span>
          Minor concern
        </div>
      </div>
    </div>
  );
}
