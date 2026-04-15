'use client';

import { RoleScorecardRow, IntelligenceBullet } from '@/lib/types';

function renderMd(text: string) {
  if (!text) return null;
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
  );
}

function normalizeBullets(raw: IntelligenceBullet[] | string | undefined): IntelligenceBullet[] {
  if (!raw) return [];
  if (typeof raw === 'string') return raw.split(/\n+/).filter(Boolean).map(t => ({ text: t.replace(/^•\s*/, '').trim() }));
  return raw;
}

interface Props {
  rows: RoleScorecardRow[];
  roleIntelligence: IntelligenceBullet[] | string;
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

      {/* Role intelligence bullets */}
      {roleIntelligence && normalizeBullets(roleIntelligence).length > 0 && (
        <div className="border-t border-[#1e2736] pt-4">
          <div className="text-xs text-[#8892a4] mb-3 uppercase tracking-wide font-medium">Analysis</div>
          <ul className="space-y-3">
            {normalizeBullets(roleIntelligence).map((b, i) => (
              <li key={i} className="flex gap-2.5 items-start">
                <span className="text-indigo-400 mt-0.5 shrink-0 select-none">•</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#c8d0e0] leading-relaxed">{renderMd(b.text)}</p>
                  {b.sourceUrl ? (
                    <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1 text-[10px] text-indigo-400/60 hover:text-indigo-300 transition-colors underline underline-offset-2">
                      ↗ {b.sourceName || 'Source'}
                    </a>
                  ) : b.sourceName ? (
                    <span className="inline-block mt-1 text-[10px] text-[#4a5568]">{b.sourceName}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
