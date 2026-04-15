'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { SalaryIntelligence } from '@/lib/types';

interface Props {
  data: SalaryIntelligence;
}

// Generate bell curve points
function generateBellCurve(min: number, max: number, median: number, points = 100) {
  const sigma = (max - min) / 6;
  const mu = median;
  const result = [];
  for (let i = 0; i <= points; i++) {
    const x = min + (i / points) * (max - min);
    const y = Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
    result.push({ x, y, salary: x });
  }
  return result;
}

export default function BellCurve({ data }: Props) {
  const { marketMin, marketMax, median, p25, p75, offerValue, percentile, verdict, targetSalary, dataNote } = data;

  const chartData = generateBellCurve(marketMin, marketMax, median);

  const verdictConfig = {
    LOW: { color: '#ef4444', bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', label: 'BELOW MARKET' },
    FAIR: { color: '#f59e0b', bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', label: 'MARKET RATE' },
    STRONG: { color: '#10b981', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', label: 'ABOVE MARKET' },
  };

  const vc = verdictConfig[verdict] || verdictConfig.FAIR;

  const fmt = (n: number) => {
    if (!n) return '$0';
    if (n >= 1000) return `$${Math.round(n / 1000)}k`;
    return `$${n.toLocaleString()}`;
  };

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { x: number } }> }) => {
    if (active && payload?.[0]) {
      const x = payload[0].payload.x;
      return (
        <div className="bg-[#0d1117] border border-[#1e2736] rounded-lg px-3 py-2 text-xs">
          <div className="text-white font-mono">${Math.round(x).toLocaleString()}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Salary Intelligence</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">Market range distribution</p>
        </div>
        <div className={`px-3 py-1.5 rounded-full ${vc.bg} border ${vc.border}`}>
          <span className={`text-xs font-bold ${vc.text}`}>{vc.label}</span>
        </div>
      </div>

      {/* Adjacent role notice — shown when direct market data wasn't available */}
      {dataNote && dataNote !== 'null' && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
          <span className="text-amber-400 text-xs mt-0.5 shrink-0">⚠</span>
          <p className="text-xs text-amber-300/80 leading-relaxed">{dataNote}</p>
        </div>
      )}

      {/* Bell curve chart */}
      <div className="h-40 relative">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="bellGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={vc.color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={vc.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="x" hide />
            <YAxis hide />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="y"
              stroke={vc.color}
              strokeWidth={2}
              fill="url(#bellGradient)"
            />
            {/* Median line */}
            <ReferenceLine
              x={median}
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              label={{ value: 'MED', fill: '#6366f1', fontSize: 9 }}
            />
            {/* Offer/target line */}
            <ReferenceLine
              x={offerValue || targetSalary}
              stroke={vc.color}
              strokeWidth={2}
              label={{ value: 'YOU', fill: vc.color, fontSize: 9 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Salary markers */}
      <div className="flex justify-between text-xs text-[#4a5568] mt-2 mb-4 font-mono">
        <span>{fmt(marketMin)}</span>
        <span className="text-indigo-400">{fmt(p25)} — {fmt(p75)}</span>
        <span>{fmt(marketMax)}</span>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#0d1117]/50 rounded-xl p-3 text-center">
          <div className="text-xs text-[#8892a4] mb-1">25th %ile</div>
          <div className="text-sm font-bold text-white font-mono">{fmt(p25)}</div>
        </div>
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 text-center">
          <div className="text-xs text-indigo-300 mb-1">Median</div>
          <div className="text-sm font-bold text-indigo-300 font-mono">{fmt(median)}</div>
        </div>
        <div className="bg-[#0d1117]/50 rounded-xl p-3 text-center">
          <div className="text-xs text-[#8892a4] mb-1">75th %ile</div>
          <div className="text-sm font-bold text-white font-mono">{fmt(p75)}</div>
        </div>
      </div>

      {/* Your position */}
      <div className={`mt-3 p-3 rounded-xl ${vc.bg} border ${vc.border} flex items-center justify-between`}>
        <span className="text-xs text-[#8892a4]">Your target</span>
        <span className="font-mono font-bold text-sm text-white">{fmt(targetSalary)}</span>
        <span className={`text-xs font-bold ${vc.text}`}>{percentile}th percentile</span>
      </div>
    </div>
  );
}
