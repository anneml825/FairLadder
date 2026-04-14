'use client';

import { NegotiationPlaybook as PlaybookType } from '@/lib/types';

interface Props {
  playbook: PlaybookType;
}

export default function NegotiationPlaybook({ playbook }: Props) {
  if (!playbook || !Array.isArray(playbook.levers)) return null;

  return (
    <div className="glass rounded-2xl p-6 border border-indigo-500/20 glow-indigo">
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Negotiation Playbook</h3>
        <p className="text-xs text-indigo-300 mt-0.5">Your tactical guide — use these exact words</p>
      </div>

      {/* Levers table */}
      <div className="mb-6">
        <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">Negotiation Levers</div>
        <div className="border border-[#1e2736] rounded-xl overflow-hidden">
          <div className="grid grid-cols-3 bg-[#0d1117] px-4 py-2 text-[10px] text-[#4a5568] uppercase tracking-wide">
            <span>Lever</span>
            <span className="text-center">Negotiable</span>
            <span className="text-center">Priority</span>
          </div>
          {[...playbook.levers].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((lever, i) => (
            <div key={i} className="grid grid-cols-3 px-4 py-3 border-t border-[#1e2736] hover:bg-[#0d1117]/50 transition-colors">
              <span className="text-sm text-white">{lever.lever}</span>
              <div className="text-center">
                {lever.negotiable ? (
                  <span className="text-xs text-emerald-400 font-medium">Yes</span>
                ) : (
                  <span className="text-xs text-red-400 font-medium">No</span>
                )}
              </div>
              <div className="text-center">
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono">
                  #{lever.priority}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Opening line */}
      <div className="mb-4">
        <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">Opening Line — Use These Exact Words</div>
        <div className="relative p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30">
          <div className="absolute top-3 left-3 text-indigo-400 text-3xl leading-none opacity-30 font-serif">&ldquo;</div>
          <p className="text-sm text-white leading-relaxed pl-6 pr-4 italic">{playbook.openingLine}</p>
          <div className="absolute bottom-3 right-3 text-indigo-400 text-3xl leading-none opacity-30 font-serif">&rdquo;</div>
        </div>
      </div>

      {/* Pushback response */}
      <div className="mb-4">
        <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">When They Say &ldquo;This Is Our Best Offer&rdquo;</div>
        <div className="relative p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <div className="absolute top-3 left-3 text-amber-400 text-3xl leading-none opacity-30 font-serif">&ldquo;</div>
          <p className="text-sm text-white leading-relaxed pl-6 pr-4 italic">{playbook.pushbackResponse}</p>
          <div className="absolute bottom-3 right-3 text-amber-400 text-3xl leading-none opacity-30 font-serif">&rdquo;</div>
        </div>
      </div>

      {/* Walk away */}
      <div>
        <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">Walk Away Recommendation</div>
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-[#c8d0e0] leading-relaxed">{playbook.walkAwayRecommendation}</p>
        </div>
      </div>
    </div>
  );
}
