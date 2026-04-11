'use client';

import { SentimentWord } from '@/lib/types';

interface Props {
  words: SentimentWord[];
}

const SENTIMENT_COLORS = {
  positive: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  negative: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  neutral: { text: 'text-[#8892a4]', bg: 'bg-[#1e2736]', border: 'border-[#2a3448]' },
};

export default function SentimentViz({ words }: Props) {
  if (!words || words.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 border border-[#1e2736]">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Sentiment Analysis</h3>
        <div className="text-center py-6 text-[#4a5568] text-sm">No sentiment data available</div>
      </div>
    );
  }

  const sorted = [...words].sort((a, b) => b.value - a.value);
  const maxVal = Math.max(...words.map(w => w.value));

  const positives = words.filter(w => w.sentiment === 'positive');
  const negatives = words.filter(w => w.sentiment === 'negative');
  const posScore = positives.reduce((a, w) => a + w.value, 0);
  const negScore = negatives.reduce((a, w) => a + w.value, 0);
  const total = posScore + negScore;
  const posPercent = total > 0 ? Math.round((posScore / total) * 100) : 50;

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Sentiment Analysis</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">From Reddit & Glassdoor — sized by frequency</p>
        </div>
      </div>

      {/* Sentiment bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-emerald-400 font-medium">Positive ({posPercent}%)</span>
          <span className="text-red-400 font-medium">Negative ({100 - posPercent}%)</span>
        </div>
        <div className="h-2 rounded-full bg-[#1e2736] overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 rounded-l-full transition-all duration-1000"
            style={{ width: `${posPercent}%` }}
          />
          <div
            className="h-full bg-red-500 rounded-r-full"
            style={{ width: `${100 - posPercent}%` }}
          />
        </div>
      </div>

      {/* Word bubbles */}
      <div className="flex flex-wrap gap-2">
        {sorted.slice(0, 30).map((word, i) => {
          const cfg = SENTIMENT_COLORS[word.sentiment];
          const size = 11 + Math.round((word.value / maxVal) * 8);
          const opacity = 0.5 + (word.value / maxVal) * 0.5;
          return (
            <span
              key={i}
              className={`inline-flex items-center px-2.5 py-1 rounded-full border font-medium ${cfg.text} ${cfg.bg} ${cfg.border}`}
              style={{
                fontSize: `${size}px`,
                opacity,
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 pt-3 border-t border-[#1e2736]">
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          Positive mentions
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          Negative mentions
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#8892a4]">
          Larger = more frequent
        </div>
      </div>
    </div>
  );
}
