'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnalysisResult } from '@/lib/types';
import RadarChart from '@/components/RadarChart';
import BellCurve from '@/components/BellCurve';
import Timeline from '@/components/Timeline';
import { RedFlagCards, GreenFlagCards } from '@/components/FlagCards';
import RoleScorecard from '@/components/RoleScorecard';
import LanguageChips from '@/components/LanguageChips';
import SentimentViz from '@/components/SentimentViz';
import NegotiationPlaybook from '@/components/NegotiationPlaybook';
import SourcesPanel from '@/components/SourcesPanel';

const VERDICT_CONFIG = {
  'STRONG OPPORTUNITY': {
    bg: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    dot: 'bg-emerald-500',
    icon: '✅',
  },
  'PROCEED WITH CAUTION': {
    bg: 'from-amber-500/20 via-amber-500/5 to-transparent',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    dot: 'bg-amber-500',
    icon: '⚠️',
  },
  'SIGNIFICANT CONCERNS': {
    bg: 'from-red-500/20 via-red-500/5 to-transparent',
    border: 'border-red-500/30',
    badge: 'bg-red-500/20 border-red-500/40 text-red-300',
    dot: 'bg-red-500',
    icon: '🚨',
  },
};

export default function ResultsPage() {
  const router = useRouter();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    const stored = sessionStorage.getItem('fairladder_result');
    if (!stored) {
      router.push('/');
      return;
    }
    try {
      setResult(JSON.parse(stored));
    } catch {
      router.push('/');
    }
  }, [router]);

  if (!result) {
    return (
      <div className="min-h-screen grid-pattern flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-[#8892a4] text-sm">Loading analysis...</p>
        </div>
      </div>
    );
  }

  const vc = VERDICT_CONFIG[result.verdict] || VERDICT_CONFIG['PROCEED WITH CAUTION'];
  const criticalFlags = result.redFlags?.filter(f => f.severity === 'critical') || [];

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'company', label: 'Company Intel' },
    { id: 'role', label: 'Role Analysis' },
    { id: 'salary', label: 'Salary' },
    { id: 'flags', label: `Flags ${result.redFlags?.length ? `(${result.redFlags.length})` : ''}` },
    { id: 'negotiate', label: 'Negotiate', hidden: !result.negotiationPlaybook },
    { id: 'sources', label: `Sources (${result.sourcesCount})` },
  ].filter(t => !t.hidden);

  return (
    <div className="min-h-screen grid-pattern">
      {/* Top nav */}
      <nav className="sticky top-0 z-50 border-b border-[#1e2736] bg-[#060810]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2 text-[#8892a4] hover:text-white transition-colors text-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              New analysis
            </button>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3">
                  <path d="M2 20L12 4L22 20H2Z" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="12" y1="12" x2="12" y2="20" stroke="#6366f1" strokeWidth="1.5"/>
                </svg>
              </div>
              <span className="font-bold tracking-tight text-xs text-white">FAIRLADDER<span className="text-indigo-400">.AI</span></span>
            </div>

            <div className="text-xs text-[#8892a4]">
              {result.sourcesCount} sources
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* BANNER */}
        <div className={`relative rounded-2xl p-6 sm:p-8 mb-6 bg-gradient-to-b ${vc.bg} border ${vc.border} overflow-hidden`}>
          {/* Background glow */}
          <div className="absolute inset-0 opacity-30">
            <div className={`absolute top-0 left-1/4 w-64 h-32 blur-3xl rounded-full ${vc.dot} opacity-20`} />
          </div>

          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                {/* Meta */}
                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-[#8892a4]">
                  <span className="font-semibold text-white">{result.companyName}</span>
                  <span>·</span>
                  <span>{result.role || 'Position'}</span>
                  <span>·</span>
                  <span>{result.location}</span>
                  <span>·</span>
                  <span>{new Date(result.analyzedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>

                {/* Verdict */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{vc.icon}</span>
                  <div>
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-bold ${vc.badge}`}>
                      <span className={`w-2 h-2 rounded-full animate-pulse ${vc.dot}`}></span>
                      {result.verdict}
                    </div>
                  </div>
                </div>

                <p className="text-[#c8d0e0] text-sm leading-relaxed max-w-2xl">{result.verdictExplanation}</p>
              </div>

              {/* Stats */}
              <div className="flex sm:flex-col gap-4 sm:gap-3 sm:text-right flex-shrink-0">
                <div>
                  <div className="text-2xl font-bold text-white font-mono">{result.sourcesCount}</div>
                  <div className="text-xs text-[#8892a4]">sources scanned</div>
                </div>
                {criticalFlags.length > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-red-400 font-mono">{criticalFlags.length}</div>
                    <div className="text-xs text-[#8892a4]">critical flags</div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom line */}
            {result.bottomLine && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-xs text-[#8892a4] uppercase tracking-wide mb-1 font-medium">Bottom Line</p>
                <p className="text-sm text-white leading-relaxed">{result.bottomLine}</p>
              </div>
            )}
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-6 scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-300'
                  : 'text-[#8892a4] hover:text-white hover:bg-[#0d1117]/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RadarChart scores={result.radarScores} />
            <BellCurve data={result.salaryIntelligence} />
            <div className="lg:col-span-2">
              <Timeline events={result.timeline || []} />
            </div>
          </div>
        )}

        {/* COMPANY INTEL TAB */}
        {activeTab === 'company' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RadarChart scores={result.radarScores} />

            <div className="glass rounded-2xl p-6 border border-[#1e2736]">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Company Intelligence</h3>
              <div className="prose prose-sm max-w-none">
                <p className="text-sm text-[#c8d0e0] leading-relaxed whitespace-pre-wrap">{result.companyIntelligence}</p>
              </div>

              {/* Glassdoor snapshot */}
              {result.rawData?.glassdoor && (
                <div className="mt-4 pt-4 border-t border-[#1e2736]">
                  <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-3 font-medium">Glassdoor Snapshot</div>
                  <div className="grid grid-cols-3 gap-3">
                    {result.rawData.glassdoor.overallRating && (
                      <div className="bg-[#0d1117]/50 rounded-xl p-3 text-center">
                        <div className="text-xl font-bold text-white">{result.rawData.glassdoor.overallRating}</div>
                        <div className="text-[10px] text-[#8892a4]">Overall Rating</div>
                      </div>
                    )}
                    {result.rawData.glassdoor.ceoApproval && (
                      <div className="bg-[#0d1117]/50 rounded-xl p-3 text-center">
                        <div className="text-xl font-bold text-white">{result.rawData.glassdoor.ceoApproval}%</div>
                        <div className="text-[10px] text-[#8892a4]">CEO Approval</div>
                      </div>
                    )}
                    {result.rawData.glassdoor.recommendToFriend && (
                      <div className="bg-[#0d1117]/50 rounded-xl p-3 text-center">
                        <div className="text-xl font-bold text-white">{result.rawData.glassdoor.recommendToFriend}%</div>
                        <div className="text-[10px] text-[#8892a4]">Recommend</div>
                      </div>
                    )}
                  </div>

                  {/* Review themes */}
                  {(result.rawData.glassdoor.pros?.length > 0 || result.rawData.glassdoor.cons?.length > 0) && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {result.rawData.glassdoor.pros?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-emerald-400 uppercase tracking-wide mb-1.5 font-medium">Pros themes</div>
                          <div className="space-y-1">
                            {result.rawData.glassdoor.pros.slice(0, 3).map((pro, i) => (
                              <div key={i} className="text-xs text-[#8892a4] pl-2 border-l border-emerald-500/30">{pro}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {result.rawData.glassdoor.cons?.length > 0 && (
                        <div>
                          <div className="text-[10px] text-red-400 uppercase tracking-wide mb-1.5 font-medium">Cons themes</div>
                          <div className="space-y-1">
                            {result.rawData.glassdoor.cons.slice(0, 3).map((con, i) => (
                              <div key={i} className="text-xs text-[#8892a4] pl-2 border-l border-red-500/30">{con}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Reddit intelligence */}
            {result.rawData?.reddit && result.rawData.reddit.length > 0 && (
              <div className="lg:col-span-2 glass rounded-2xl p-6 border border-[#1e2736]">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">
                  Reddit Intelligence <span className="text-[#4a5568] font-normal normal-case text-xs ml-1">{result.rawData.reddit.length} threads found</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {result.rawData.reddit.slice(0, 6).map((thread, i) => (
                    <div key={i} className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/15 hover:border-orange-500/30 transition-colors">
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-xs text-orange-400 font-medium flex-shrink-0">r/{thread.subreddit}</span>
                        <span className="text-xs text-[#4a5568] flex-shrink-0">↑{thread.score}</span>
                      </div>
                      <a href={thread.url} target="_blank" rel="noopener noreferrer" className="text-xs text-white hover:text-indigo-300 transition-colors block mb-2 line-clamp-2">
                        {thread.title}
                      </a>
                      {thread.topComments?.[0] && (
                        <p className="text-[11px] text-[#8892a4] italic line-clamp-2 border-l border-[#2a3448] pl-2">
                          &ldquo;{thread.topComments[0]}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment */}
            <div className="lg:col-span-2">
              <SentimentViz words={result.sentimentWords || []} />
            </div>

            {/* Timeline */}
            <div className="lg:col-span-2">
              <Timeline events={result.timeline || []} />
            </div>
          </div>
        )}

        {/* ROLE TAB */}
        {activeTab === 'role' && (
          <div className="grid grid-cols-1 gap-6">
            <RoleScorecard rows={result.roleScorecard || []} roleIntelligence={result.roleIntelligence} />
            <LanguageChips warnings={result.languageWarnings || []} />
          </div>
        )}

        {/* SALARY TAB */}
        {activeTab === 'salary' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="lg:col-span-2">
              <BellCurve data={result.salaryIntelligence} />
            </div>

            <div className="glass rounded-2xl p-6 border border-[#1e2736]">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Salary Analysis</h3>
              <p className="text-sm text-[#c8d0e0] leading-relaxed whitespace-pre-wrap">{result.salaryAnalysis}</p>
            </div>

            {/* BLS data */}
            {result.rawData?.bls && (
              <div className="glass rounded-2xl p-6 border border-[#1e2736]">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">BLS Market Data</h3>
                <div className="text-xs text-[#8892a4] mb-3">{result.rawData.bls.occupationTitle}</div>
                <div className="space-y-2">
                  {[
                    { label: '10th Percentile', value: result.rawData.bls.p10 },
                    { label: '25th Percentile', value: result.rawData.bls.p25 },
                    { label: 'Median (50th)', value: result.rawData.bls.medianSalary, highlight: true },
                    { label: '75th Percentile', value: result.rawData.bls.p75 },
                    { label: '90th Percentile', value: result.rawData.bls.p90 },
                  ].filter(row => row.value).map((row, i) => (
                    <div key={i} className={`flex justify-between items-center p-2 rounded-lg ${row.highlight ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-[#0d1117]/30'}`}>
                      <span className={`text-xs ${row.highlight ? 'text-indigo-300' : 'text-[#8892a4]'}`}>{row.label}</span>
                      <span className={`text-sm font-bold font-mono ${row.highlight ? 'text-indigo-300' : 'text-white'}`}>
                        ${row.value?.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Levels.fyi data */}
            {result.rawData?.levels && result.rawData.levels.targetRoleSalaries.length > 0 && (
              <div className="glass rounded-2xl p-6 border border-[#1e2736]">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Levels.fyi Data</h3>
                <div className="space-y-2">
                  {result.rawData.levels.targetRoleSalaries.map((salary, i) => (
                    <div key={i} className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/15">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-white font-medium">{salary.role}</span>
                        <span className="text-xs text-[#4a5568]">{salary.location}</span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span className="text-[#8892a4]">Base: <span className="text-purple-300 font-mono">${salary.base?.toLocaleString()}</span></span>
                        <span className="text-[#8892a4]">Total: <span className="text-purple-300 font-mono">${salary.totalComp?.toLocaleString()}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FLAGS TAB */}
        {activeTab === 'flags' && (
          <div className="grid grid-cols-1 gap-6">
            <RedFlagCards flags={result.redFlags || []} />
            <GreenFlagCards flags={result.greenFlags || []} />
          </div>
        )}

        {/* NEGOTIATE TAB */}
        {activeTab === 'negotiate' && result.negotiationPlaybook && (
          <div className="max-w-2xl mx-auto">
            <NegotiationPlaybook playbook={result.negotiationPlaybook} />
            {result.offerAnalysis && (
              <div className="mt-6 glass rounded-2xl p-6 border border-[#1e2736]">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Offer Analysis</h3>
                <p className="text-sm text-[#c8d0e0] leading-relaxed whitespace-pre-wrap">{result.offerAnalysis}</p>
              </div>
            )}
          </div>
        )}

        {/* SOURCES TAB */}
        {activeTab === 'sources' && (
          <SourcesPanel sources={result.sources || []} totalCount={result.sourcesCount} />
        )}

        {/* Bottom CTA */}
        <div className="mt-12 text-center py-8 border-t border-[#1e2736]">
          <p className="text-xs text-[#4a5568] mb-3">Analysis complete · {result.sourcesCount} sources scanned</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-sm hover:bg-indigo-500/20 transition-all"
          >
            Run another analysis
          </button>
        </div>
      </div>
    </div>
  );
}
