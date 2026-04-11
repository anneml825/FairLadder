'use client';

import { RoleScorecardRow } from '@/lib/types';

interface Props {
  rows: RoleScorecardRow[];
  roleIntelligence: string;
}

const STATUS_CONFIG = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'GOOD' },
  yellow: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'CAUTION' },
  red: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'CONCERN' },
};

export default function RoleScorecard({ rows, roleIntelligence }: Props) {
  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Role Reality Check</h3>
        <p className="text-xs text-[#8892a4] mt-0.5">What the posting actually signals</p>
      </div>

      {/* Scorecard table */}
      <div className="space-y-2 mb-6">
        {rows.map((row, i) => {
          const cfg = STATUS_CONFIG[row.status];
          return (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
              <div className={`flex-shrink-0 w-2 h-2 rounded-full ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">{row.dimension}</span>
                  <span className={`text-[10px] font-bold ${cfg.text}`}>{cfg.label}</span>
                </div>
                <p className="text-xs text-[#8892a4] mt-0.5">{row.explanation}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Role intelligence text */}
      {roleIntelligence && (
        <div className="border-t border-[#1e2736] pt-4">
          <div className="text-xs text-[#8892a4] mb-2 uppercase tracking-wide font-medium">Analysis</div>
          <p className="text-sm text-[#c8d0e0] leading-relaxed whitespace-pre-wrap">{roleIntelligence}</p>
        </div>
      )}
    </div>
  );
}
