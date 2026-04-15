'use client';

import { useState } from 'react';
import { ScrapedSource } from '@/lib/types';

interface Props {
  sources: ScrapedSource[];
  totalCount: number;
}

const TYPE_CONFIG: Record<ScrapedSource['type'], { label: string; color: string; bg: string; icon: string; group: string }> = {
  'google-news': { label: 'Google News', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', icon: '📰', group: 'News & Press' },
  reddit:        { label: 'Reddit',      color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', icon: '🗣️', group: 'Employee Reviews' },
  glassdoor:     { label: 'Glassdoor',   color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: '⭐', group: 'Employee Reviews' },
  levels:        { label: 'Levels.fyi',  color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', icon: '💰', group: 'Salary Data' },
  bls:           { label: 'BLS.gov',     color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', icon: '📊', group: 'Salary Data' },
  sec:           { label: 'SEC / EDGAR', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: '📋', group: 'Company Financials' },
  'job-posting': { label: 'Job Posting', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', icon: '📄', group: 'Job Posting' },
  crunchbase:    { label: 'Crunchbase',  color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20', icon: '💡', group: 'Company Financials' },
};

const GROUP_ORDER = ['Job Posting', 'News & Press', 'Company Financials', 'Employee Reviews', 'Salary Data'];

function SourceRow({ source }: { source: ScrapedSource }) {
  const cfg = TYPE_CONFIG[source.type] || TYPE_CONFIG['google-news'];
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[#0d1117]/50 transition-colors group"
    >
      <span className="text-sm flex-shrink-0">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#c8d0e0] truncate group-hover:text-white transition-colors">
          {source.title || source.url}
        </div>
        <div className="text-[10px] text-[#4a5568] truncate">{source.url}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
        {source.timestamp && (
          <span className="text-[10px] text-[#4a5568] hidden sm:block">
            {new Date(source.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </a>
  );
}

export default function SourcesPanel({ sources, totalCount }: Props) {
  const [filter, setFilter] = useState<ScrapedSource['type'] | 'all'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const filtered = filter === 'all' ? sources : sources.filter(s => s.type === filter);

  const typeCounts = sources.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Group sources by their category
  const grouped = GROUP_ORDER.reduce((acc, group) => {
    const items = filtered.filter(s => TYPE_CONFIG[s.type]?.group === group);
    if (items.length) acc[group] = items;
    return acc;
  }, {} as Record<string, ScrapedSource[]>);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  // Default: show first 5 per group, expand on click
  const PREVIEW = 5;

  return (
    <div className="glass rounded-2xl p-6 border border-[#1e2736]">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Intelligence Sources</h3>
          <p className="text-xs text-[#8892a4] mt-0.5">Every source scanned for this analysis</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold gradient-text font-mono">{totalCount}</div>
          <div className="text-xs text-[#8892a4]">total sources</div>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
            filter === 'all'
              ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
              : 'bg-[#0d1117] border-[#1e2736] text-[#8892a4] hover:text-white'
          }`}
        >
          All ({sources.length})
        </button>
        {Object.entries(typeCounts).map(([type, count]) => {
          const cfg = TYPE_CONFIG[type as ScrapedSource['type']];
          if (!cfg) return null;
          return (
            <button
              key={type}
              onClick={() => setFilter(type as ScrapedSource['type'])}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                filter === type
                  ? `${cfg.bg} ${cfg.color}`
                  : 'bg-[#0d1117] border-[#1e2736] text-[#8892a4] hover:text-white'
              }`}
            >
              {cfg.icon} {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Grouped source list */}
      {filter === 'all' ? (
        <div className="space-y-5">
          {Object.entries(grouped).map(([group, items]) => {
            const isExpanded = expandedGroups[group];
            const shown = isExpanded ? items : items.slice(0, PREVIEW);
            return (
              <div key={group}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-[#4a5568] uppercase tracking-widest font-semibold">{group}</span>
                  <div className="flex-1 h-px bg-[#1e2736]" />
                  <span className="text-[10px] text-[#4a5568]">{items.length}</span>
                </div>
                <div className="space-y-0.5">
                  {shown.map((source, i) => <SourceRow key={i} source={source} />)}
                </div>
                {items.length > PREVIEW && (
                  <button
                    onClick={() => toggleGroup(group)}
                    className="mt-1 ml-3 text-[10px] text-indigo-400/60 hover:text-indigo-300 transition-colors"
                  >
                    {isExpanded ? '↑ Show less' : `↓ ${items.length - PREVIEW} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat list when a specific type is filtered */
        <div className="space-y-0.5">
          {filtered.map((source, i) => <SourceRow key={i} source={source} />)}
        </div>
      )}
    </div>
  );
}
