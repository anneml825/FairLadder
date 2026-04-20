'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  AnalysisRequest,
  GlassdoorData,
  LevelsData,
  BLSData,
  SECData,
  ScrapedSource,
  GoogleNewsResult,
  RedditThread,
  JobPostingData,
  EnrichmentData,
} from '@/lib/types';

// ─── Step definitions ────────────────────────────────────────────────────────

type StepId =
  | 'job'
  | 'news'
  | 'reddit'
  | 'glassdoor'
  | 'levels'
  | 'bls'
  | 'sec'
  | 'enrich'
  | 'claude';

type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface Step {
  id: StepId;
  label: string;
  icon: string;
  status: StepStatus;
  count: number;
  error?: string;
}

const INITIAL_STEPS: Step[] = [
  { id: 'job',      label: 'Finding & analyzing job posting',          icon: '📄', status: 'pending', count: 0 },
  { id: 'news',     label: 'Scanning company news & press releases',   icon: '📰', status: 'pending', count: 0 },
  { id: 'reddit',   label: 'Reading Reddit employee threads',          icon: '🗣️', status: 'pending', count: 0 },
  { id: 'glassdoor',label: 'Checking Glassdoor, Comparably, Indeed & Blind', icon: '⭐', status: 'pending', count: 0 },
  { id: 'levels',   label: 'Levels.fyi & comparable company salaries',        icon: '💰', status: 'pending', count: 0 },
  { id: 'bls',      label: 'BLS, ZipRecruiter, Payscale & H-1B DOL data',   icon: '📊', status: 'pending', count: 0 },
  { id: 'sec',      label: 'SEC, WARN Act, Crunchbase & LinkedIn signals',   icon: '📋', status: 'pending', count: 0 },
  { id: 'enrich',   label: 'EDGAR financials, court records & GitHub',       icon: '🏛️', status: 'pending', count: 0 },
  { id: 'claude',   label: 'Running intelligence analysis',                  icon: '🤖', status: 'pending', count: 0 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [totalSources, setTotalSources] = useState(0);
  const [displaySources, setDisplaySources] = useState(0);
  const [error, setError] = useState('');
  const [dots, setDots] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Animated dots for running step
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(id);
  }, []);

  // Smoothly animate the source counter up
  useEffect(() => {
    if (displaySources >= totalSources) return;
    const id = setTimeout(() => {
      setDisplaySources(d => Math.min(d + Math.max(1, Math.ceil((totalSources - d) / 8)), totalSources));
    }, 60);
    return () => clearTimeout(id);
  }, [totalSources, displaySources]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const setStep = (id: StepId, patch: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const addSources = (n: number) => setTotalSources(t => t + n);

  const inferCompanyContext = (text: string) => {
    const lower = text.toLowerCase();
    const ctxSignals: string[] = [];
    if (/\bcrypto\b|cryptocurrency|digital asset|bitcoin|blockchain|web3|defi|exchange/i.test(lower)) ctxSignals.push('crypto');
    if (/\bai\b|artificial intelligence|machine learning|llm|gpt|generative/i.test(lower)) ctxSignals.push('AI');
    if (/startup|series [a-e]|seed round|venture.backed|vc.backed|early.stage/i.test(lower)) ctxSignals.push('startup');
    if (/private equity|private markets|deal management|portfolio company/i.test(lower)) ctxSignals.push('private equity');
    if (/fintech|financial technology|payments|trading platform|brokerage/i.test(lower)) ctxSignals.push('fintech');
    if (/healthcare|health.?tech|medical/i.test(lower)) ctxSignals.push('healthcare');
    if (/saas|software.as.a.service|cloud.based|enterprise software/i.test(lower)) ctxSignals.push('SaaS');
    if (/ecommerce|e.commerce|marketplace/i.test(lower)) ctxSignals.push('ecommerce');
    if (/cybersecurity|security platform|infosec/i.test(lower)) ctxSignals.push('cybersecurity');
    if (/investor relations|earnings|shareholders|public company|nasdaq|nyse/i.test(lower)) ctxSignals.push('public company');
    return ctxSignals.slice(0, 4).join(' ');
  };

  // Generic JSON fetcher with timeout
  async function fetchStep<T>(
    id: StepId,
    url: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T | null> {
    setStep(id, { status: 'running' });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as T;
      return data;
    } catch (e: unknown) {
      if ((e as { name: string }).name === 'AbortError') return null;
      setStep(id, { status: 'error', error: (e as Error).message });
      return null;
    }
  }

  // ── Main effect ────────────────────────────────────────────────────────────

  useEffect(() => {
    const stored = sessionStorage.getItem('fairladder_request');
    if (!stored) { router.replace('/'); return; }

    const request: AnalysisRequest = JSON.parse(stored);

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const run = async () => {
      // ── 1. Job posting (only if URL provided) ────────────────────────────
      let jobPosting: JobPostingData | undefined;
      const pastedJobText = request.jobText || '';
      const initialCompanyContext = inferCompanyContext(pastedJobText);
      if (request.jobUrl) {
        setStep('job', { status: 'running' });
        const res = await fetchStep<{ data: JobPostingData; sources: ScrapedSource[]; loginWall?: boolean }>(
          'job', '/api/scrape/job', { url: request.jobUrl }, signal,
        );
        if (res?.loginWall) {
          // Site requires login — can't scrape. Tell user to paste and redirect back.
          sessionStorage.setItem('fairladder_loginwall', '1');
          router.push('/?loginwall=1');
          return;
        }
        if (res) {
          jobPosting = res.data;
          // User-supplied title wins outright
          if (request.jobTitle) {
            jobPosting = { ...res.data, title: request.jobTitle };
          } else {
            // Cross-validate: if the scraped title doesn't appear in the job text at all,
            // it likely came from a list page or the wrong job — fall back to text extraction.
            const scrapedTitle = res.data?.title || '';
            const fullText = res.data?.fullText || '';
            const titleInText = scrapedTitle && fullText.toLowerCase().includes(
              scrapedTitle.toLowerCase().replace(/,.*$/, '').trim()
            );
            if (!titleInText && fullText.length > 200) {
              const lines = fullText.split(/[\n.]+/).map(l => l.trim()).filter(l =>
                l.length > 5 && l.length < 80 && /[A-Z]/.test(l) &&
                !/^(about|apply|benefits|requirements|the company|we are|location)/i.test(l)
              );
              if (lines[0]) jobPosting = { ...res.data, title: lines[0] };
            }
          }
          addSources(res.sources.length);
          setStep('job', { status: 'done', count: 1 });
        } else if (signal.aborted) return;
        else setStep('job', { status: 'done', count: 0 });
      } else {
        // Paste mode — extract a clean job title from the pasted text
        const pastedLines = (request.jobText || '').split('\n').map(l => l.trim()).filter(Boolean);
        // Skip lines that look like company slogans/taglines/addresses
        const extractedTitle = pastedLines.find(
          l => l.length > 3 && l.length < 80 &&
               !l.toLowerCase().includes(request.companyName.toLowerCase().split(' ')[0]) &&
               !/^(about|we are|we're|join|apply|the role|overview|description|location|salary|benefits|requirements|connecting|talent|opportunity|our|the company|who we|what we)/i.test(l) &&
               !/^\d|^https?:|—|–/.test(l) &&
               /[A-Z]/.test(l) // must have at least one capital letter (title-like)
        ) || pastedLines[0] || '';

        // Try to find the actual job posting URL to get postedDate
        setStep('job', { status: 'running' });
        const jobSearchRes = await fetchStep<{ data: JobPostingData; sources: ScrapedSource[]; foundUrl?: string }>(
          'job',
          '/api/scrape/job',
          {
            companyName: request.companyName,
            role: extractedTitle,
            companyContext: initialCompanyContext,
            jobText: pastedJobText,
          },
          signal,
        );

        jobPosting = {
          title: request.jobTitle || jobSearchRes?.data?.title || extractedTitle,
          company: request.companyName,
          location: jobSearchRes?.data?.location || request.location,
          salaryRange: jobSearchRes?.data?.salaryRange || null,
          requirements: jobSearchRes?.data?.requirements || [],
          responsibilities: jobSearchRes?.data?.responsibilities || [],
          benefits: jobSearchRes?.data?.benefits || [],
          remotePolicy: jobSearchRes?.data?.remotePolicy || 'Not specified',
          // Use posted date from the found posting — this is the key value
          postedDate: jobSearchRes?.data?.postedDate || '',
          // Always use pasted text as the fullText — most accurate
          fullText: request.jobText || '',
          isRepost: false,
        };
        addSources(jobSearchRes?.sources?.length || 1);
        if (!signal.aborted) setStep('job', { status: 'done', count: 1 });
      }

      // User-supplied title is authoritative — overrides anything the scraper extracted
      const role = request.jobTitle || jobPosting?.title || '';

      // Extract disambiguating context from the job posting so scrapers don't
      // confuse "Meridian AI startup" with "Meridian Idaho" or "Meridian IT".
      const jobFullText = jobPosting?.fullText || request.jobText || '';
      const companyContext = inferCompanyContext(jobFullText) || initialCompanyContext;

      // ── 2. Fire all scraping calls in PARALLEL ────────────────────────────
      const [newsRes, redditRes, glassdoorRes, levelsRes, blsRes, secRes, enrichRes] = await Promise.all([

        fetchStep<{ results: GoogleNewsResult[]; sources: ScrapedSource[] }>(
          'news', '/api/scrape/news', { companyName: request.companyName, role, companyContext }, signal,
        ),

        fetchStep<{ threads: RedditThread[]; sources: ScrapedSource[] }>(
          'reddit', '/api/scrape/reddit', { companyName: request.companyName, role, companyContext }, signal,
        ),

        fetchStep<{ data: GlassdoorData; sources: ScrapedSource[] }>(
          'glassdoor', '/api/scrape/glassdoor', { companyName: request.companyName, role, companyContext }, signal,
        ),

        fetchStep<{ data: LevelsData; sources: ScrapedSource[] }>(
          'levels', '/api/scrape/levels', { companyName: request.companyName, role, location: request.location, companyContext }, signal,
        ),

        fetchStep<{ data: BLSData; sources: ScrapedSource[] }>(
          'bls', '/api/scrape/bls', { role: role || 'professional worker', location: request.location, companyName: request.companyName, companyContext }, signal,
        ),

        fetchStep<{ data: SECData; sources: ScrapedSource[] }>(
          'sec', '/api/scrape/sec', { companyName: request.companyName, companyContext }, signal,
        ),

        fetchStep<{ data: EnrichmentData; sources: ScrapedSource[] }>(
          'enrich', '/api/scrape/enrich', { companyName: request.companyName, companyContext }, signal,
        ),
      ]);

      if (signal.aborted) return;

      // Mark each step done and add sources
      if (newsRes) {
        setStep('news', { status: 'done', count: newsRes.results.length });
        addSources(newsRes.sources.length);
      } else if (!signal.aborted) {
        setStep('news', { status: 'error', count: 0 });
      }

      if (redditRes) {
        setStep('reddit', { status: 'done', count: redditRes.threads.length });
        addSources(redditRes.sources.length);
      } else if (!signal.aborted) {
        setStep('reddit', { status: 'error', count: 0 });
      }

      if (glassdoorRes) {
        setStep('glassdoor', { status: 'done', count: glassdoorRes.sources.length });
        addSources(glassdoorRes.sources.length);
      } else if (!signal.aborted) {
        setStep('glassdoor', { status: 'error', count: 0 });
      }

      if (levelsRes) {
        setStep('levels', { status: 'done', count: levelsRes.data.targetRoleSalaries.length + levelsRes.data.comparableSalaries.length });
        addSources(levelsRes.sources.length);
      } else if (!signal.aborted) {
        setStep('levels', { status: 'error', count: 0 });
      }

      if (blsRes) {
        setStep('bls', { status: 'done', count: blsRes.sources.length });
        addSources(blsRes.sources.length);
      } else if (!signal.aborted) {
        setStep('bls', { status: 'error', count: 0 });
      }

      if (secRes) {
        setStep('sec', { status: 'done', count: secRes.sources.length });
        addSources(secRes.sources.length);
      } else if (!signal.aborted) {
        setStep('sec', { status: 'error', count: 0 });
      }

      if (enrichRes) {
        setStep('enrich', { status: 'done', count: enrichRes.sources.length });
        addSources(enrichRes.sources.length);
      } else if (!signal.aborted) {
        setStep('enrich', { status: 'error', count: 0 });
      }

      // ── 3. Aggregate all sources ──────────────────────────────────────────
      const allSources: ScrapedSource[] = [
        ...(newsRes?.sources || []),
        ...(redditRes?.sources || []),
        ...(glassdoorRes?.sources || []),
        ...(levelsRes?.sources || []),
        ...(blsRes?.sources || []),
        ...(secRes?.sources || []),
        ...(enrichRes?.sources || []),
      ];

      // ── 4. Claude analysis (streaming from Edge function) ─────────────────
      setStep('claude', { status: 'running' });

      const defaultGlassdoor: GlassdoorData = {
        overallRating: null, ratingTrend: 'N/A', ceoApproval: null,
        recommendToFriend: null, pros: [], cons: [], salaryData: null,
        interviewDifficulty: null, interviewExperience: null, reviewCount: null,
      };
      const defaultLevels: LevelsData = { targetRoleSalaries: [], comparableSalaries: [] };
      const defaultBLS: BLSData = {
        occupationTitle: role || '', medianSalary: null,
        p10: null, p25: null, p75: null, p90: null,
        yearOverYearChange: 'N/A', locationData: '',
      };
      const defaultSEC: SECData = { filings: [], layoffSignals: [], executiveDepartures: [], fundingSignals: [], financialSignals: [] };

      try {
        const claudeRes = await fetch('/api/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request,
            scrapedData: {
              news: newsRes?.results || [],
              reddit: redditRes?.threads || [],
              glassdoor: glassdoorRes?.data || defaultGlassdoor,
              levels: levelsRes?.data || defaultLevels,
              bls: blsRes?.data || defaultBLS,
              sec: secRes?.data || defaultSEC,
              jobPosting,
              enrich: enrichRes?.data,
            },
            sources: allSources,
          }),
          signal,
        });

        if (!claudeRes.body) throw new Error('No response stream');

        const reader = claudeRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'thinking') {
                // Show progress during Claude streaming
                setStep('claude', { status: 'running', count: data.chars });
              } else if (data.type === 'result') {
                setStep('claude', { status: 'done', count: 1 });
                sessionStorage.setItem('fairladder_result', JSON.stringify(data.data));
                // Remove request only after result is safely saved — prevents losing state if user navigates away mid-analysis
                sessionStorage.removeItem('fairladder_request');
                router.replace('/results');
              } else if (data.type === 'error') {
                setStep('claude', { status: 'error', error: data.message });
                setError(data.message || 'Analysis failed');
              }
            } catch { /* skip malformed SSE */ }
          }
        }
      } catch (e: unknown) {
        if ((e as { name: string }).name !== 'AbortError') {
          setStep('claude', { status: 'error' });
          setError('Analysis failed. Please try again.');
        }
      }
    };

    run();
    return () => abortRef.current?.abort();
  }, [router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = Math.max(4, Math.round((doneCount / steps.length) * 100));
  const runningStep = steps.find(s => s.status === 'running');

  return (
    <div className="min-h-screen grid-pattern flex flex-col items-center justify-center px-4 py-16">
      {/* Logo */}
      <div className="mb-12 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M2 20L12 4L22 20H2Z" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round"/>
            <line x1="12" y1="12" x2="12" y2="20" stroke="#6366f1" strokeWidth="1.5"/>
          </svg>
        </div>
        <span className="font-bold tracking-tight text-white">FAIRLADDER<span className="text-indigo-400">.AI</span></span>
      </div>

      <div className="w-full max-w-xl">
        <div className="glass rounded-2xl p-8 border border-[#1e2736]">
          {error ? (
            /* Error state */
            <div className="text-center py-8">
              <div className="text-4xl mb-4">⚠️</div>
              <h2 className="text-xl font-bold text-white mb-2">Analysis Failed</h2>
              <p className="text-[#8892a4] text-sm mb-6">{error}</p>
              <button
                onClick={() => router.push('/')}
                className="px-6 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                  Intelligence scan in progress
                </div>

                <h2 className="text-xl font-bold text-white mb-3">
                  {runningStep ? `${runningStep.label}${dots}` : `Initializing${dots}`}
                </h2>

                {/* Sources counter */}
                <div className="flex items-center justify-center gap-2 text-[#8892a4] text-sm">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-indigo-400">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M11 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span>
                    <span className="text-white font-bold text-2xl tabular-nums">{displaySources}</span>
                    <span className="ml-1">sources found</span>
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-[#1e2736] rounded-full mb-6 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Steps list */}
              <div className="space-y-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${
                      step.status === 'running'
                        ? 'bg-indigo-500/10 border border-indigo-500/20'
                        : step.status === 'done'
                        ? 'bg-[#0d1117]/40'
                        : step.status === 'error'
                        ? 'bg-red-500/8 border border-red-500/20'
                        : 'opacity-30'
                    }`}
                  >
                    {/* Status icon */}
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {step.status === 'done' ? (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-emerald-400">
                            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      ) : step.status === 'running' ? (
                        <svg className="animate-spin w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                      ) : step.status === 'error' ? (
                        <span className="text-red-400 text-xs font-bold">✕</span>
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-[#2a3448]"/>
                      )}
                    </div>

                    {/* Emoji icon */}
                    <span className="text-sm flex-shrink-0">{step.icon}</span>

                    {/* Label */}
                    <span className={`flex-1 text-sm ${
                      step.status === 'running' ? 'text-white font-medium' :
                      step.status === 'done' ? 'text-[#8892a4]' :
                      step.status === 'error' ? 'text-red-400' :
                      'text-[#4a5568]'
                    }`}>
                      {step.label}
                      {step.status === 'running' && step.id === 'claude' && step.count > 0 && (
                        <span className="text-indigo-400 text-xs ml-1 font-mono">{step.count} chars</span>
                      )}
                    </span>

                    {/* Count badge */}
                    {step.status === 'done' && step.count > 0 && step.id !== 'claude' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono flex-shrink-0">
                        +{step.count}
                      </span>
                    )}
                    {step.status === 'running' && step.id !== 'claude' && (
                      <span className="text-xs text-indigo-400 font-mono flex-shrink-0">{dots}</span>
                    )}
                  </div>
                ))}
              </div>

              <p className="text-center text-xs text-[#4a5568] mt-6">
                Sources scanned in parallel — takes about 15–30 seconds
              </p>
            </>
          )}
        </div>
      </div>

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl"/>
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl"/>
      </div>
    </div>
  );
}
