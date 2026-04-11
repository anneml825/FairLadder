'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const TICKER_ITEMS = [
  'SALARY INTELLIGENCE', 'COMPANY HEALTH SCORES', 'RED FLAG DETECTION',
  'NEGOTIATION PLAYBOOK', 'SEC FILING ANALYSIS', 'REDDIT SENTIMENT',
  'GLASSDOOR DEEP DIVE', 'OFFER ANALYSIS', 'MARKET BENCHMARKING',
  'CULTURE SIGNALS', 'LAYOFF RISK SCORING', 'CEO APPROVAL RATINGS',
];

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<'url' | 'paste'>('paste');
  const [form, setForm] = useState({
    jobUrl: '',
    jobText: '',
    companyName: '',
    location: '',
    salaryMin: '',
    salaryMax: '',
    offerText: '',
  });
  const [showOffer, setShowOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    setCharCount(form.jobText.length);
  }, [form.jobText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.companyName.trim()) { setError('Company name is required'); return; }
    if (!form.location.trim()) { setError('Location is required'); return; }
    if (!form.salaryMin || !form.salaryMax) { setError('Salary range is required'); return; }
    if (tab === 'url' && !form.jobUrl.trim()) { setError('Job posting URL is required'); return; }
    if (tab === 'paste' && !form.jobText.trim()) { setError('Job posting text is required'); return; }

    setLoading(true);

    const request = {
      jobUrl: tab === 'url' ? form.jobUrl : undefined,
      jobText: tab === 'paste' ? form.jobText : undefined,
      companyName: form.companyName,
      location: form.location,
      salaryMin: parseInt(form.salaryMin.replace(/[^0-9]/g, '')),
      salaryMax: parseInt(form.salaryMax.replace(/[^0-9]/g, '')),
      offerText: form.offerText || undefined,
    };

    sessionStorage.setItem('fairladder_request', JSON.stringify(request));
    router.push('/analyze');
  };

  const formatSalary = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    if (!num) return '';
    return parseInt(num).toLocaleString();
  };

  return (
    <div className="min-h-screen grid-pattern flex flex-col">
      {/* Top nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-[#1e2736] bg-[#060810]/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path d="M2 20L12 4L22 20H2Z" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="12" y1="12" x2="12" y2="20" stroke="#6366f1" strokeWidth="1.5"/>
            </svg>
          </div>
          <span className="font-bold tracking-tight text-sm text-white">FAIRLADDER<span className="text-indigo-400">.AI</span></span>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#8892a4]">
          <span className="hidden sm:block">For candidates. By design.</span>
          <a href="#how" className="hover:text-white transition-colors">How it works</a>
        </div>
      </nav>

      {/* Ticker */}
      <div className="fixed top-[57px] left-0 right-0 z-40 border-b border-[#1e2736] bg-[#0d1117]/60 overflow-hidden h-8 flex items-center">
        <div className="ticker-inner flex gap-8 whitespace-nowrap">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span key={i} className="text-[10px] font-mono tracking-widest text-indigo-400/60 uppercase">
              {item} <span className="text-[#1e2736] mx-2">◆</span>
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center pt-32 pb-20 px-4">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block"></span>
          Candidate Intelligence Platform — Level the playing field
        </div>

        {/* Headline */}
        <h1 className="text-center font-bold leading-tight mb-4 max-w-3xl">
          <span className="block text-5xl sm:text-6xl md:text-7xl text-white tracking-tight">
            Know what they
          </span>
          <span className="block text-5xl sm:text-6xl md:text-7xl gradient-text tracking-tight">
            know about you.
          </span>
        </h1>

        <p className="text-center text-[#8892a4] text-lg max-w-xl mb-12 leading-relaxed">
          Companies have recruiters, data teams, and salary analytics. You have a job description and a gut feeling.
          <strong className="text-white"> We fix that.</strong>
        </p>

        {/* Form card */}
        <div className="w-full max-w-2xl">
          <div className="glass rounded-2xl p-6 sm:p-8 glow-indigo">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Tab toggle */}
              <div className="flex rounded-xl bg-[#0d1117] p-1 border border-[#1e2736]">
                <button
                  type="button"
                  onClick={() => setTab('paste')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                    tab === 'paste'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-[#8892a4] hover:text-white'
                  }`}
                >
                  Paste job posting
                </button>
                <button
                  type="button"
                  onClick={() => setTab('url')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                    tab === 'url'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-[#8892a4] hover:text-white'
                  }`}
                >
                  Job posting URL
                </button>
              </div>

              {/* Job input */}
              {tab === 'paste' ? (
                <div className="relative">
                  <textarea
                    value={form.jobText}
                    onChange={e => setForm(f => ({ ...f, jobText: e.target.value }))}
                    placeholder="Paste the full job posting here — the more detail the better. Include the job description, requirements, responsibilities, salary if listed..."
                    rows={6}
                    className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-colors"
                  />
                  <div className="absolute bottom-3 right-3 text-xs text-[#4a5568]">
                    {charCount.toLocaleString()} chars
                  </div>
                </div>
              ) : (
                <input
                  type="url"
                  value={form.jobUrl}
                  onChange={e => setForm(f => ({ ...f, jobUrl: e.target.value }))}
                  placeholder="https://www.linkedin.com/jobs/view/..."
                  className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                />
              )}

              {/* Company + Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#8892a4] mb-1.5 uppercase tracking-wide">Company name</label>
                  <input
                    type="text"
                    value={form.companyName}
                    onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                    placeholder="e.g. Stripe, Salesforce..."
                    className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#8892a4] mb-1.5 uppercase tracking-wide">Your location</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. San Francisco, CA"
                    className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                  />
                </div>
              </div>

              {/* Salary range */}
              <div>
                <label className="block text-xs font-medium text-[#8892a4] mb-1.5 uppercase tracking-wide">Target salary range</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8892a4] text-sm">$</span>
                    <input
                      type="text"
                      value={form.salaryMin}
                      onChange={e => setForm(f => ({ ...f, salaryMin: formatSalary(e.target.value) }))}
                      placeholder="120,000"
                      className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl pl-7 pr-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8892a4] text-sm">$</span>
                    <input
                      type="text"
                      value={form.salaryMax}
                      onChange={e => setForm(f => ({ ...f, salaryMax: formatSalary(e.target.value) }))}
                      placeholder="160,000"
                      className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl pl-7 pr-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Optional offer */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowOffer(s => !s)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                >
                  <span>{showOffer ? '▼' : '▶'}</span>
                  {showOffer ? 'Hide' : 'Add'} offer details for negotiation analysis (optional)
                </button>
                {showOffer && (
                  <textarea
                    value={form.offerText}
                    onChange={e => setForm(f => ({ ...f, offerText: e.target.value }))}
                    placeholder="Paste your offer letter or offer details — base salary, bonus, equity, vesting schedule, benefits, etc."
                    rows={4}
                    className="mt-2 w-full bg-[#0d1117] border border-indigo-500/20 rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-colors"
                  />
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <span>⚠</span> {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 px-6 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/40 text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Starting analysis...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
                      <path d="M21 21L16 16M18 11A7 7 0 1 1 4 11a7 7 0 0 1 14 0Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Run Intelligence Analysis
                  </>
                )}
              </button>

              <p className="text-center text-xs text-[#4a5568]">
                Analysis takes 30–60 seconds · Scans 40+ sources · No API keys required
              </p>
            </form>
          </div>
        </div>

        {/* How it works */}
        <section id="how" className="w-full max-w-4xl mt-24 px-4">
          <h2 className="text-center text-2xl font-bold text-white mb-2">What we analyze</h2>
          <p className="text-center text-[#8892a4] text-sm mb-12">Every analysis scrapes dozens of live sources in real time</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '📰', title: 'Google News', desc: '12 months of company news — layoffs, lawsuits, pivots, leadership changes' },
              { icon: '🗣️', title: 'Reddit Intelligence', desc: 'Real employee and candidate discussions across 12+ subreddits' },
              { icon: '⭐', title: 'Glassdoor Deep Dive', desc: 'Rating trends, CEO approval, real review themes, interview data' },
              { icon: '💰', title: 'Salary Benchmarking', desc: 'Levels.fyi + BLS data — where your offer really sits in the market' },
              { icon: '📋', title: 'SEC Filing Analysis', desc: 'Material events, executive departures, financial distress signals' },
              { icon: '🤖', title: 'Claude AI Analysis', desc: 'Brutally honest synthesis — what it all means for you specifically' },
            ].map(item => (
              <div key={item.title} className="glass rounded-xl p-4 border border-[#1e2736] hover:border-indigo-500/20 transition-colors">
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="font-semibold text-white text-sm mb-1">{item.title}</div>
                <div className="text-[#8892a4] text-xs leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Stats */}
        <div className="mt-16 flex flex-wrap gap-8 sm:gap-16 justify-center text-center">
          {[
            { value: '40+', label: 'Sources per analysis' },
            { value: '$0', label: 'APIs used — pure scraping' },
            { value: '100%', label: 'Candidate-first design' },
          ].map(stat => (
            <div key={stat.label}>
              <div className="text-3xl font-bold gradient-text">{stat.value}</div>
              <div className="text-xs text-[#8892a4] mt-1 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1e2736] py-6 px-6 flex items-center justify-between text-xs text-[#4a5568]">
        <span>FAIRLADDER.AI — For candidates, by design</span>
        <span>No APIs. No BS. Just intelligence.</span>
      </footer>
    </div>
  );
}
