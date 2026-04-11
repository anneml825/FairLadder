'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AnalysisResult } from '@/lib/types';

interface ProgressStep {
  step: string;
  status: 'pending' | 'running' | 'done' | 'error';
  count?: number;
}

const STEP_ICONS: Record<string, string> = {
  'Analyzing job posting': '📄',
  'Processing job posting text': '📄',
  'Scanning Google News': '📰',
  'Reading Reddit threads': '🗣️',
  'Scraping Glassdoor reviews': '⭐',
  'Checking Levels.fyi salary data': '💰',
  'Pulling BLS salary statistics': '📊',
  'Searching SEC filings': '📋',
  'Running intelligence analysis': '🤖',
};

const getIcon = (step: string) => {
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (step.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return '🔍';
};

export default function AnalyzePage() {
  const router = useRouter();
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [sourcesCount, setSourcesCount] = useState(0);
  const [displayCount, setDisplayCount] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('Initializing intelligence scan...');
  const [dots, setDots] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const countRef = useRef(0);

  // Animated dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // Animate sources counter
  useEffect(() => {
    if (sourcesCount > displayCount) {
      const diff = sourcesCount - displayCount;
      const step = Math.max(1, Math.ceil(diff / 10));
      const timer = setTimeout(() => {
        setDisplayCount(c => Math.min(c + step, sourcesCount));
        countRef.current = Math.min(countRef.current + step, sourcesCount);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [sourcesCount, displayCount]);

  useEffect(() => {
    const request = sessionStorage.getItem('fairladder_request');
    if (!request) {
      router.push('/');
      return;
    }

    const requestData = JSON.parse(request);
    abortRef.current = new AbortController();

    const runAnalysis = async () => {
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
          signal: abortRef.current!.signal,
        });

        if (!response.body) {
          setError('No response from server');
          return;
        }

        const reader = response.body.getReader();
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

              if (data.type === 'progress') {
                const { step, status, sourcesCount: newCount } = data;
                setCurrentMessage(step);
                if (newCount !== undefined) {
                  setSourcesCount(prev => prev + newCount);
                }

                setSteps(prev => {
                  const existing = prev.find(s => s.step === step);
                  if (existing) {
                    return prev.map(s => s.step === step ? { ...s, status, count: newCount } : s);
                  }
                  return [...prev, { step, status, count: newCount }];
                });

              } else if (data.type === 'result') {
                const result: AnalysisResult = data.data;
                sessionStorage.setItem('fairladder_result', JSON.stringify(result));
                router.push('/results');

              } else if (data.type === 'error') {
                setError(data.message || 'Analysis failed');
              }
            } catch { /* skip malformed SSE */ }
          }
        }
      } catch (e: unknown) {
        if ((e as { name: string }).name !== 'AbortError') {
          setError('Analysis failed. Please try again.');
        }
      }
    };

    runAnalysis();

    return () => {
      abortRef.current?.abort();
    };
  }, [router]);

  const runningStep = steps.find(s => s.status === 'running');
  const doneSteps = steps.filter(s => s.status === 'done');
  const progress = Math.max(5, (doneSteps.length / 9) * 100);

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

      {/* Main card */}
      <div className="w-full max-w-xl">
        <div className="glass rounded-2xl p-8 border border-[#1e2736]">
          {error ? (
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
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block"></span>
                  Intelligence scan in progress
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {runningStep ? runningStep.step + dots : 'Initializing' + dots}
                </h2>

                {/* Sources counter */}
                <div className="flex items-center justify-center gap-2 text-[#8892a4] text-sm">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-indigo-400">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M11 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span>
                    <span className="text-white font-bold text-lg tabular-nums">{displayCount}</span> sources found
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-[#1e2736] rounded-full mb-8 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Steps list */}
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-300 ${
                      step.status === 'running' ? 'bg-indigo-500/10 border border-indigo-500/20' :
                      step.status === 'done' ? 'bg-[#0d1117]/50' :
                      step.status === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                      'opacity-40'
                    }`}
                  >
                    {/* Status indicator */}
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                      {step.status === 'done' ? (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-emerald-400">
                            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      ) : step.status === 'running' ? (
                        <svg className="animate-spin w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : step.status === 'error' ? (
                        <span className="text-red-400 text-sm">✕</span>
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-[#2a3448]" />
                      )}
                    </div>

                    {/* Icon */}
                    <span className="text-base">{getIcon(step.step)}</span>

                    {/* Step text */}
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm ${
                        step.status === 'running' ? 'text-white font-medium' :
                        step.status === 'done' ? 'text-[#8892a4]' :
                        'text-[#4a5568]'
                      }`}>
                        {step.step}
                      </span>
                    </div>

                    {/* Count badge */}
                    {step.status === 'done' && step.count !== undefined && step.count > 0 && (
                      <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                        +{step.count}
                      </span>
                    )}
                    {step.status === 'running' && (
                      <span className="flex-shrink-0 text-xs text-indigo-400 font-mono">{dots}</span>
                    )}
                  </div>
                ))}

                {/* Pending placeholder steps */}
                {steps.length < 9 && Array.from({ length: Math.max(0, 9 - steps.length) }).map((_, i) => (
                  <div key={`pending-${i}`} className="flex items-center gap-3 p-3 rounded-xl opacity-20">
                    <div className="w-5 h-5 rounded-full border border-[#2a3448] flex-shrink-0" />
                    <div className="h-3 bg-[#1e2736] rounded flex-1 shimmer" />
                  </div>
                ))}
              </div>

              {/* Bottom note */}
              <p className="text-center text-xs text-[#4a5568] mt-6">
                Scanning public sources in real time — this takes 30–60 seconds
              </p>
            </>
          )}
        </div>
      </div>

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl" />
      </div>
    </div>
  );
}
