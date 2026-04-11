'use client';

import { RadarChart as RechartsRadar, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { RadarScore } from '@/lib/types';

interface Props {
  scores: RadarScore;
}

const COLORS = {
  financialStability: '#6366f1',
  culture: '#10b981',
  leadership: '#f59e0b',
  growthTrajectory: '#06b6d4',
  retention: '#8b5cf6',
  transparency: '#ec4899',
};

const LABELS: Record<keyof RadarScore, string> = {
  financialStability: 'Financial',
  culture: 'Culture',
  leadership: 'Leadership',
  growthTrajectory: 'Growth',
  retention: 'Retention',
  transparency: 'Transparency',
};

export default function RadarChart({ scores }: Props) {
  const data = Object.entries(scores).map(([key, value]) => ({
    dimension: LABELS[key as keyof RadarScore],
    value,
    fullMark: 10,
  }));

  const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length * 10) / 10;

  const getColor = (score: number) => {
    if (score >= 7) return '#10b981';
    if (score >= 4) return '#f59e0b';
    return '#ef4444';
  };

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { dimension: string; value: number } }> }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-[#0d1117] border border-[#1e2736] rounded-lg px-3 py-2 text-xs">
          <div className="text-white font-medium">{item.dimension}</div>
          <div className="text-indigo-300 font-bold">{item.value}/10</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Company Health</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">6-dimension analysis</p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${getColor(avg)}`} style={{ color: getColor(avg) }}>
            {avg}
          </div>
          <div className="text-xs text-[#8892a4]">out of 10</div>
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsRadar data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid
              gridType="polygon"
              stroke="#1e2736"
              strokeWidth={1}
            />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: '#8892a4', fontSize: 10, fontFamily: 'Inter' }}
            />
            <Radar
              name="Score"
              dataKey="value"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{ fill: '#6366f1', r: 3, strokeWidth: 0 }}
            />
            <Tooltip content={<CustomTooltip />} />
          </RechartsRadar>
        </ResponsiveContainer>
      </div>

      {/* Score breakdown */}
      <div className="grid grid-cols-2 gap-2 mt-4">
        {Object.entries(scores).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-[#0d1117]/50">
            <span className="text-xs text-[#8892a4]">{LABELS[key as keyof RadarScore]}</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 bg-[#1e2736] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${value * 10}%`, backgroundColor: getColor(value) }}
                />
              </div>
              <span className="text-xs font-mono font-bold" style={{ color: getColor(value) }}>{value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
