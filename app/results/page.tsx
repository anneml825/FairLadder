'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnalysisResult, IntelligenceBullet } from '@/lib/types';
import RadarChart from '@/components/RadarChart';
import BellCurve from '@/components/BellCurve';
import Timeline from '@/components/Timeline';
import { RedFlagCards, GreenFlagCards } from '@/components/FlagCards';
import RoleScorecard from '@/components/RoleScorecard';
import LanguageChips from '@/components/LanguageChips';
import SentimentViz from '@/components/SentimentViz';
import NegotiationPlaybook from '@/components/NegotiationPlaybook';
import SourcesPanel from '@/components/SourcesPanel';

function renderMd(text: string) {
  if (!text) return null;
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
  );
}

function renderOfferAnalysis(text: string) {
  if (!text) return null;
  const lines = text.split('\n').filter(l => l.trim());
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const isBullet = /^[•\-\*]\s/.test(line.trim());
        const content = isBullet ? line.trim().replace(/^[•\-\*]\s+/, '') : line;
        return isBullet ? (
          <div key={i} className="flex gap-2.5 items-start">
            <span className="text-indigo-400 mt-0.5 shrink-0 select-none">•</span>
            <p className="text-sm text-[#c8d0e0] leading-relaxed">{renderMd(content)}</p>
          </div>
        ) : (
          <p key={i} className="text-sm text-[#c8d0e0] leading-relaxed">{renderMd(line)}</p>
        );
      })}
    </div>
  );
}

// Normalise: Claude may return bullets as an array or (legacy) a plain string
function normalizeBullets(raw: IntelligenceBullet[] | string | undefined): IntelligenceBullet[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw.split(/\n+/).filter(Boolean).map(t => ({ text: t.replace(/^•\s*/, '').trim() }));
  }
  return raw;
}

function BulletList({ bullets }: { bullets: IntelligenceBullet[] }) {
  if (!bullets.length) return <p className="text-sm text-[#4a5568] italic">No data found.</p>;
  return (
    <ul className="space-y-3">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2.5 items-start">
          <span className="text-indigo-400 mt-0.5 shrink-0 select-none">•</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#c8d0e0] leading-relaxed">{renderMd(b.text)}</p>
            {b.sourceUrl ? (
              <a
                href={b.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-[10px] text-indigo-400/60 hover:text-indigo-300 transition-colors underline underline-offset-2"
              >
                ↗ {b.sourceName || 'Source'}
              </a>
            ) : b.sourceName ? (
              <span className="inline-block mt-1 text-[10px] text-[#4a5568]">{b.sourceName}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

type TaggedSignal = {
  title: string;
  detail: string;
  url?: string;
};

function splitSignalText(text: string): [string, string] {
  const parts = text.split(/\s+â€”\s+|\s+—\s+|\s+-\s+/);
  const [title, ...rest] = parts;
  return [title?.trim() || text.trim(), rest.join(' — ').trim()];
}

function parseTaggedSignal(signal: string): TaggedSignal {
  const urlMatch = signal.match(/\[URL:(.*?)\]/);
  const text = signal.replace(/\[URL:.*?\]/, '').trim();
  const [title, detail] = splitSignalText(text);
  return { title, detail, url: urlMatch?.[1] };
}

function hasGlassdoorSnapshot(result: AnalysisResult): boolean {
  const glassdoor = result.rawData?.glassdoor;
  if (!glassdoor) return false;
  return Boolean(
    glassdoor.overallRating ||
    glassdoor.ceoApproval ||
    glassdoor.recommendToFriend ||
    glassdoor.reviewCount ||
    glassdoor.pros?.length ||
    glassdoor.cons?.length
  );
}

function shouldShowGitHub(result: AnalysisResult): boolean {
  const role = result.role.toLowerCase();
  return /engineer|developer|software|frontend|backend|full\s?stack|platform|devops|sre|qa|security|data|machine learning|ml|ai|architect/.test(role);
}

function summarizeNLRBSignals(signals: string[]): string {
  const parsed = signals.map(parseTaggedSignal);
  const unionCount = parsed.filter(({ title, detail }) => /union|petition|election|mailers/i.test(`${title} ${detail}`)).length;
  const complaintCount = parsed.filter(({ title, detail }) => /complaint|charge|unfair labor practice|case against/i.test(`${title} ${detail}`)).length;

  if (parsed.length === 1) {
    if (unionCount === 1) return 'One NLRB filing surfaced, and it reads more like a union-related matter than a broad pattern of labor complaints.';
    if (complaintCount === 1) return 'One NLRB complaint surfaced, which is worth opening but is not enough on its own to show a repeated labor-relations problem.';
    return 'One NLRB-related record surfaced, so the useful next step is to open it and see whether it is procedural noise or an actual labor dispute.';
  }

  const lead = complaintCount > 1
    ? `${parsed.length} NLRB records surfaced, including multiple complaint-style filings that could point to recurring labor friction.`
    : `${parsed.length} NLRB records surfaced, but they appear mixed rather than a single clear pattern.`;
  const follow = unionCount
    ? 'Several of them look union-related, so this reads more like organizing activity plus labor process than a single simple complaint.'
    : 'These should be read individually because NLRB entries can include procedural filings, elections, and employer complaints in the same bucket.';
  return `${lead} ${follow}`;
}

function summarizeOSHASignals(signals: string[]): string {
  const parsed = signals.map(parseTaggedSignal);
  const enforcementCount = parsed.filter(({ title, detail }) => /inspection|citation|penalt|fine|violation/i.test(`${title} ${detail}`)).length;
  const injuryDataCount = parsed.filter(({ title, detail }) => /injury|illness|establishment/i.test(`${title} ${detail}`)).length;

  if (!parsed.length) return '';
  if (enforcementCount === 0 && injuryDataCount > 0) {
    return 'The OSHA hits here look like injury or establishment datasets, not obvious enforcement actions, so this is more context than a direct safety red flag for the role.';
  }
  if (enforcementCount === 1) {
    return 'One OSHA enforcement-style record surfaced, which is worth checking for severity and recency before treating it as a meaningful workplace-risk signal.';
  }
  return `${parsed.length} OSHA records surfaced, including ${enforcementCount} inspection or citation-style hits, so this is worth reading as a potential operating-risk signal rather than generic safety boilerplate.`;
}

function summarizeCourtCases(cases: NonNullable<NonNullable<AnalysisResult['rawData']['enrichment']>['courtCases']>): string {
  const recentCases = cases.filter(c => Number.parseInt(c.dateFiled.slice(0, 4), 10) >= 2021);
  const employmentCount = cases.filter(c => c.caseType === 'employment' || c.caseType === 'discrimination' || c.caseType === 'wage').length;

  if (cases.length === 1) {
    return 'One company-linked federal case surfaced, so the main question is the claim type and whether it looks isolated or representative.';
  }

  const lead = recentCases.length
    ? `${cases.length} company-linked federal cases surfaced, with ${recentCases.length} filed since 2021.`
    : `${cases.length} company-linked federal cases surfaced in the lookback window.`;
  const follow = employmentCount >= 2
    ? 'Because several are employment-related, this is a real culture and management signal rather than random legal noise.'
    : 'That still needs context because a single old case is very different from a cluster of recent employment claims.';
  return `${lead} ${follow}`;
}

function stripMd(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').trim();
}

function getTopBullets(raw: IntelligenceBullet[] | string | undefined, limit = 2): string[] {
  return normalizeBullets(raw)
    .map(b => stripMd(b.text))
    .filter(Boolean)
    .slice(0, limit);
}

function getRecommendedAction(verdict: string): string {
  if (verdict === 'STRONG OPPORTUNITY') return 'Pursue this role, but go in prepared on compensation, team fit, and scope specifics.';
  if (verdict === 'SIGNIFICANT CONCERNS') return 'Treat this as a high-risk opportunity unless the company can resolve the major concerns clearly and directly.';
  return 'Keep this in play, but verify the weak spots before spending more interview time or negotiating from assumptions.';
}

function getRecruiterQuestions(result: AnalysisResult): string[] {
  const questions: string[] = [];
  const remotePolicy = result.roleScorecard?.find(row => row.dimension === 'Remote Policy Reliability');
  const titleAccuracy = result.roleScorecard?.find(row => row.dimension === 'Title Accuracy');
  const seniorityMatch = result.roleScorecard?.find(row => row.dimension === 'Seniority-Responsibility Match');

  if (remotePolicy && remotePolicy.status !== 'green') {
    questions.push('Can you confirm the exact remote, hybrid, or in-office expectation in writing?');
  }
  if (titleAccuracy && titleAccuracy.status !== 'green') {
    questions.push('How does this role map internally by level, expectations, and promotion path?');
  }
  if (seniorityMatch && seniorityMatch.status !== 'green') {
    questions.push('Which responsibilities are truly core to the role, and which ones are handled by partner teams?');
  }
  if (result.salaryIntelligence?.verdict === 'LOW') {
    questions.push('What compensation band has actually been approved for someone at my level and location?');
  }
  if (result.dataGaps?.length) {
    questions.push('What would someone only learn about this team after joining that I should know now?');
  }

  return [...new Set(questions)].slice(0, 3);
}

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
  const [showAllReddit, setShowAllReddit] = useState(false);

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
  const cautionFlags = result.redFlags?.filter(f => f.severity !== 'critical') || [];
  const topCompanyBullets = getTopBullets(result.companyIntelligence, 2);
  const topRoleBullets = getTopBullets(result.roleIntelligence, 2);
  const topSalaryBullets = getTopBullets(result.salaryAnalysis, 2);
  const recruiterQuestions = getRecruiterQuestions(result);
  const recommendation = getRecommendedAction(result.verdict);

  const tabs = [
    { id: 'overview', label: 'Decision' },
    { id: 'salary', label: 'Comp' },
    { id: 'flags', label: `Risk ${result.redFlags?.length ? `(${result.redFlags.length})` : ''}` },
    { id: 'company', label: 'Company Intel' },
    { id: 'role', label: 'Role Analysis' },
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
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 glass rounded-2xl p-6 border border-[#1e2736]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Decision Brief</h3>
                  <p className="text-xs text-[#8892a4] mt-1">The fastest read on whether this opportunity is worth pursuing</p>
                </div>
                <button
                  onClick={() => setActiveTab('sources')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Inspect evidence ->
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#0d1117]/60 border border-[#1e2736] mb-4">
                <div className="text-[10px] text-[#8892a4] uppercase tracking-widest mb-2">Recommended Action</div>
                <p className="text-base text-white leading-relaxed">{recommendation}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/15">
                  <div className="text-[10px] text-emerald-400 uppercase tracking-widest mb-2">Best Signals</div>
                  <div className="space-y-2">
                    {(result.greenFlags?.slice(0, 2).map(flag => flag.explanation) || topCompanyBullets.slice(0, 2)).filter(Boolean).slice(0, 2).map((text, i) => (
                      <p key={i} className="text-sm text-[#c8d0e0] leading-relaxed">{text}</p>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/15">
                  <div className="text-[10px] text-red-400 uppercase tracking-widest mb-2">Watch Closely</div>
                  <div className="space-y-2">
                    {(criticalFlags.length ? criticalFlags : cautionFlags).slice(0, 2).map((flag, i) => (
                      <p key={i} className="text-sm text-[#c8d0e0] leading-relaxed">{flag.explanation}</p>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/15">
                  <div className="text-[10px] text-indigo-400 uppercase tracking-widest mb-2">Ask Next</div>
                  <div className="space-y-2">
                    {recruiterQuestions.map((question, i) => (
                      <p key={i} className="text-sm text-[#c8d0e0] leading-relaxed">{question}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl p-6 border border-[#1e2736]">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Comp Snapshot</h3>
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-[#0d1117]/60 border border-[#1e2736]">
                  <div className="text-[10px] text-[#8892a4] uppercase tracking-widest mb-1">Positioning</div>
                  <div className="flex items-end justify-between gap-3">
                    <div className="text-lg font-bold text-white">{result.salaryIntelligence?.verdict || 'UNKNOWN'}</div>
                    {typeof result.salaryIntelligence?.percentile === 'number' && (
                      <div className="text-sm text-indigo-300 font-mono">{result.salaryIntelligence.percentile}th pct</div>
                    )}
                  </div>
                </div>

                {typeof result.salaryIntelligence?.targetSalary === 'number' && (
                  <div className="p-3 rounded-xl bg-[#0d1117]/60 border border-[#1e2736]">
                    <div className="text-[10px] text-[#8892a4] uppercase tracking-widest mb-1">Target Salary</div>
                    <div className="text-lg font-bold text-white font-mono">
                      ${result.salaryIntelligence.targetSalary.toLocaleString()}
                    </div>
                  </div>
                )}

                {typeof result.salaryIntelligence?.median === 'number' && (
                  <div className="p-3 rounded-xl bg-[#0d1117]/60 border border-[#1e2736]">
                    <div className="text-[10px] text-[#8892a4] uppercase tracking-widest mb-1">Market Median</div>
                    <div className="text-lg font-bold text-white font-mono">
                      ${result.salaryIntelligence.median.toLocaleString()}
                    </div>
                  </div>
                )}

                <div className="pt-1 space-y-2">
                  {topSalaryBullets.map((text, i) => (
                    <p key={i} className="text-sm text-[#c8d0e0] leading-relaxed">{text}</p>
                  ))}
                </div>

                <button
                  onClick={() => setActiveTab('salary')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Open compensation analysis ->
                </button>
              </div>
            </div>

            <RadarChart scores={result.radarScores} />

            {/* Language warning chips — red/yellow only, with link to full Role tab */}
            {result.languageWarnings?.some(w => w.severity === 'red' || w.severity === 'yellow') && (
              <div className="glass rounded-2xl p-4 border border-[#1e2736]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Posting Language</h3>
                  <button onClick={() => setActiveTab('role')} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                    See full analysis →
                  </button>
                </div>
                <div className="space-y-2">
                  {result.languageWarnings
                    .filter(w => w.severity === 'red' || w.severity === 'yellow')
                    .map((w, i) => (
                      <div key={i} className={`p-2.5 rounded-xl border text-xs ${
                        w.severity === 'red'
                          ? 'bg-red-500/10 border-red-500/30'
                          : 'bg-amber-500/10 border-amber-500/25'
                      }`}>
                        <span className={`font-semibold ${w.severity === 'red' ? 'text-red-300' : 'text-amber-300'}`}>
                          &ldquo;{w.phrase}&rdquo;
                        </span>
                        {w.explanation && (
                          <p className="text-[#8892a4] mt-0.5 leading-relaxed">{w.explanation}</p>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="xl:col-span-3">
              <Timeline events={result.timeline || []} />
            </div>
          </div>
        )}

        {/* COMPANY INTEL TAB */}
        {activeTab === 'company' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <div className="glass rounded-2xl p-6 border border-[#1e2736]">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Company Intelligence</h3>
              <BulletList bullets={normalizeBullets(result.companyIntelligence)} />

              {/* dataGaps — only shown when Claude flags them as meaningful signals, not routine absences */}
              {result.dataGaps && result.dataGaps.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[#1e2736]">
                  <div className="text-[10px] text-amber-400/70 uppercase tracking-wide mb-2 font-medium">⚠ Notable gaps</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.dataGaps.map((gap, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300/80 border border-amber-500/20">
                        {gap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* EDGAR company vitals — public companies only */}
              {result.rawData?.enrichment?.companyFacts?.isPublic && (() => {
                const f = result.rawData.enrichment!.companyFacts!;
                const fmt = (n?: number) => n === undefined ? null : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${Math.round(n / 1e6)}M`;
                const yoy = (curr?: number, prev?: number) => {
                  if (!curr || !prev) return null;
                  const pct = Math.round((curr - prev) / prev * 100);
                  return { pct, up: curr >= prev };
                };
                return (
                  <div className="mt-4 pt-4 border-t border-[#1e2736]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-[#8892a4] uppercase tracking-wide font-medium">EDGAR 10-K Financials</div>
                      <span className="text-[10px] text-[#4a5568]">{f.filingYear} annual filing</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {f.employeeCount && (
                        <div className="bg-[#0d1117]/50 rounded-xl p-3">
                          <div className="text-[10px] text-[#8892a4] mb-1">Headcount</div>
                          <div className="text-sm font-bold text-white">{f.employeeCount.toLocaleString()}</div>
                          {yoy(f.employeeCount, f.employeeCountPriorYear) && (() => { const t = yoy(f.employeeCount, f.employeeCountPriorYear)!; return <div className={`text-[10px] mt-0.5 ${t.up ? 'text-emerald-400' : 'text-red-400'}`}>{t.up ? '↑' : '↓'} {Math.abs(t.pct)}% YoY</div>; })()}
                        </div>
                      )}
                      {fmt(f.revenue) && (
                        <div className="bg-[#0d1117]/50 rounded-xl p-3">
                          <div className="text-[10px] text-[#8892a4] mb-1">Revenue</div>
                          <div className="text-sm font-bold text-white font-mono">{fmt(f.revenue)}</div>
                          {yoy(f.revenue, f.revenuePriorYear) && (() => { const t = yoy(f.revenue, f.revenuePriorYear)!; return <div className={`text-[10px] mt-0.5 ${t.up ? 'text-emerald-400' : 'text-red-400'}`}>{t.up ? '↑' : '↓'} {Math.abs(t.pct)}% YoY</div>; })()}
                        </div>
                      )}
                      {f.netIncome !== undefined && (
                        <div className="bg-[#0d1117]/50 rounded-xl p-3">
                          <div className="text-[10px] text-[#8892a4] mb-1">Net Income</div>
                          <div className={`text-sm font-bold font-mono ${f.netIncome >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {f.netIncome < 0 ? '-' : ''}{fmt(Math.abs(f.netIncome))}
                          </div>
                        </div>
                      )}
                      {fmt(f.cashOnHand) && (
                        <div className="bg-[#0d1117]/50 rounded-xl p-3">
                          <div className="text-[10px] text-[#8892a4] mb-1">Cash</div>
                          <div className="text-sm font-bold text-white font-mono">{fmt(f.cashOnHand)}</div>
                        </div>
                      )}
                    </div>
                    <a
                      href={`https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(result.companyName)}&action=getcompany&type=10-K`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-[10px] text-indigo-400/60 hover:text-indigo-300 transition-colors"
                    >
                      ↗ SEC EDGAR filings
                    </a>
                  </div>
                );
              })()}

              {/* NLRB labor signals */}
              {(result.nlrbSummary || (result.rawData?.enrichment?.nlrbSignals && result.rawData.enrichment.nlrbSignals.length > 0)) && (
                <div className="mt-4 pt-4 border-t border-[#1e2736]">
                  <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">NLRB Labor Complaints</div>
                  <p className="text-sm text-[#c8d0e0] leading-relaxed">
                    {result.nlrbSummary || summarizeNLRBSignals(result.rawData?.enrichment?.nlrbSignals ?? [])}
                  </p>
                  <p className="text-[10px] text-[#4a5568] mt-2">Source: NLRB case database</p>
                </div>
              )}

              {/* OSHA safety signals */}
              {(result.oshaSummary || (result.rawData?.enrichment?.oshaSignals && result.rawData.enrichment.oshaSignals.length > 0)) && (
                <div className="mt-4 pt-4 border-t border-[#1e2736]">
                  <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-2 font-medium">OSHA Safety Violations</div>
                  <p className="text-sm text-[#c8d0e0] leading-relaxed">
                    {result.oshaSummary || summarizeOSHASignals(result.rawData?.enrichment?.oshaSignals ?? [])}
                  </p>
                  <p className="text-[10px] text-[#4a5568] mt-2">Source: OSHA inspection records</p>
                </div>
              )}

              {/* H-1B LCA wage data */}
              {result.rawData?.enrichment?.lca && (() => {
                const lca = result.rawData.enrichment!.lca!;
                const fmt = (n: number) => `$${n.toLocaleString()}`;
                return (
                  <div className="mt-4 pt-4 border-t border-[#1e2736]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-[#8892a4] uppercase tracking-wide font-medium">H-1B LCA Wages (DOL Certified)</div>
                      <span className="text-[10px] text-[#4a5568]">{lca.sampleSize} filings</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[
                        { label: 'Min', value: fmt(lca.wageMin) },
                        { label: 'Median', value: fmt(lca.wageMedian) },
                        { label: 'Max', value: fmt(lca.wageMax) },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-2 rounded-xl bg-[#0d1117]/50 border border-[#1e2736] text-center">
                          <div className="text-[10px] text-[#4a5568] mb-1">{label}</div>
                          <div className="text-xs font-mono text-[#e2e8f0] font-semibold">{value}</div>
                        </div>
                      ))}
                    </div>
                    {lca.topRoles.length > 0 && (
                      <div className="space-y-1">
                        {lca.topRoles.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-[#1e2736]/50">
                            <span className="text-[#8892a4] truncate mr-2">{r.title}</span>
                            <span className="text-[#e2e8f0] font-mono flex-shrink-0">{fmt(r.medianWage)} <span className="text-[#4a5568]">×{r.count}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-[#4a5568] mt-2">Source: DOL OFLC H-1B disclosure data</p>
                  </div>
                );
              })()}

              {/* GitHub presence — only relevant for tech roles */}
              {result.rawData?.enrichment?.github?.orgHandle && shouldShowGitHub(result) && (
                <div className="mt-4 pt-4 border-t border-[#1e2736]">
                  <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-3 font-medium">GitHub Presence</div>
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-[#0d1117]/50 border border-[#1e2736]">
                    <span className="text-lg flex-shrink-0">⌥</span>
                    <div className="flex-1 min-w-0">
                      <a
                        href={`https://github.com/${result.rawData.enrichment.github.orgHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-mono transition-colors"
                      >
                        github.com/{result.rawData.enrichment.github.orgHandle}
                      </a>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-[#8892a4]">
                        {result.rawData.enrichment.github.publicRepos !== undefined && (
                          <span>{result.rawData.enrichment.github.publicRepos} public repos</span>
                        )}
                        <span className={result.rawData.enrichment.github.recentlyActive ? 'text-emerald-400' : 'text-amber-400'}>
                          {result.rawData.enrichment.github.recentlyActive ? '● Active (90d)' : '● Dormant (90d+)'}
                        </span>
                        {result.rawData.enrichment.github.totalStars !== undefined && (
                          <span>★ {result.rawData.enrichment.github.totalStars.toLocaleString()} stars</span>
                        )}
                      </div>
                      {result.rawData.enrichment.github.topLanguages?.length ? (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {result.rawData.enrichment.github.topLanguages.map((lang, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                              {lang}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {/* Federal court cases */}
              {result.rawData?.enrichment?.courtCases && result.rawData.enrichment.courtCases.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#1e2736]">
                  <div className="text-xs text-[#8892a4] uppercase tracking-wide mb-3 font-medium">Federal Court Cases</div>
                  <p className="text-sm text-[#c8d0e0] leading-relaxed mb-3">
                    {summarizeCourtCases(result.rawData.enrichment.courtCases)}
                  </p>
                  <div className="space-y-2">
                    {result.rawData.enrichment.courtCases.slice(0, 3).map((c, i) => {
                      const typeColor =
                        c.caseType === 'discrimination' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                        c.caseType === 'wage' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                        c.caseType === 'securities' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
                        'text-[#8892a4] bg-[#1e2736] border-[#2a3448]';
                      return (
                        <div key={i} className="p-3 rounded-xl bg-[#0d1117]/50 border border-[#1e2736] hover:border-[#2a3448] transition-colors">
                          <div className="flex items-start gap-2 mb-1">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 font-medium ${typeColor}`}>
                              {c.caseType}
                            </span>
                            <span className="text-[10px] text-[#4a5568] flex-shrink-0">{c.dateFiled}</span>
                            {c.court && <span className="text-[10px] text-[#4a5568]">· {c.court}</span>}
                          </div>
                          {c.url ? (
                            <a href={c.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-[#c8d0e0] hover:text-indigo-300 transition-colors block leading-snug">
                              {c.title}
                            </a>
                          ) : (
                            <p className="text-xs text-[#c8d0e0] leading-snug">{c.title}</p>
                          )}
                          {c.snippet && (
                            <p className="text-[11px] text-[#4a5568] mt-1 italic line-clamp-2">{c.snippet}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[#4a5568] mt-2">Source: CourtListener federal court records</p>
                </div>
              )}

              {/* Glassdoor snapshot */}
              {hasGlassdoorSnapshot(result) && result.rawData?.glassdoor && (
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
                  {(showAllReddit ? result.rawData.reddit : result.rawData.reddit.slice(0, 6)).map((thread, i) => (
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
                {result.rawData.reddit.length > 6 && (
                  <button
                    onClick={() => setShowAllReddit(s => !s)}
                    className="mt-4 w-full py-2 text-xs text-orange-400/70 hover:text-orange-300 border border-[#1e2736] hover:border-orange-500/30 rounded-xl transition-all"
                  >
                    {showAllReddit ? 'Show fewer threads' : `Show all ${result.rawData.reddit.length} threads`}
                  </button>
                )}
              </div>
            )}

            {/* Sentiment */}
            <div className="lg:col-span-2">
              <SentimentViz words={result.sentimentWords || []} />
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
              <BulletList bullets={normalizeBullets(result.salaryAnalysis)} />
            </div>

            {/* BLS data — only show when we actually have salary figures */}
            {result.rawData?.bls?.medianSalary && (
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
                <h3 className="text-sm font-semibold text-white uppercase tracking-wide mb-4">Market Salary Data</h3>
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
                {renderOfferAnalysis(result.offerAnalysis)}
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

