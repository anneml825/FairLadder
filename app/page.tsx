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
    jobTitle: '',
    companyName: '',
    location: '',
    postedSalaryMin: '',
    postedSalaryMax: '',
    desiredSalaryMin: '',
    desiredSalaryMax: '',
    offerText: '',
  });
  const [showOffer, setShowOffer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    setCharCount(form.jobText.length);
  }, [form.jobText]);

  const normalizeLocation = (input: string): string => {
    const map: Record<string, string> = {
      'sf': 'San Francisco, CA', 'bay area': 'San Francisco, CA',
      'nyc': 'New York, NY', 'ny': 'New York, NY', 'new york': 'New York, NY',
      'la': 'Los Angeles, CA', 'los angeles': 'Los Angeles, CA',
      'dc': 'Washington, DC', 'washington dc': 'Washington, DC',
      'chi': 'Chicago, IL', 'chicago': 'Chicago, IL',
      'bos': 'Boston, MA',
      'sea': 'Seattle, WA',
      'atl': 'Atlanta, GA',
      'aus': 'Austin, TX',
      'den': 'Denver, CO',
      'phx': 'Phoenix, AZ',
      'mia': 'Miami, FL',
      'pdx': 'Portland, OR',
      'slc': 'Salt Lake City, UT',
      'rdu': 'Raleigh, NC',
      'min': 'Minneapolis, MN',
    };
    const key = input.trim().toLowerCase();
    return map[key] ?? input;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.companyName.trim()) { setError('Company name is required'); return; }
    if (!form.location.trim()) { setError('Location is required'); return; }
    if (!form.desiredSalaryMin || !form.desiredSalaryMax) { setError('Desired salary range is required'); return; }
    if (tab === 'url' && !form.jobUrl.trim()) { setError('Job posting URL is required'); return; }
    if (tab === 'paste' && !form.jobText.trim()) { setError('Job posting text is required'); return; }

    // Guard against accidentally entered shorthand (e.g. "120" meaning $120k)
    const rawMin = parseInt(form.desiredSalaryMin.replace(/[^0-9]/g, '') || '0');
    const rawMax = parseInt(form.desiredSalaryMax.replace(/[^0-9]/g, '') || '0');
    if (rawMin > 0 && rawMin < 1000) { setError('Salary looks too low — enter the full amount, e.g. 85000 for $85k'); return; }
    if (rawMax > 0 && rawMax < 1000) { setError('Salary looks too low — enter the full amount, e.g. 150000 for $150k'); return; }

    setLoading(true);

    const toNum = (s: string) => { const n = parseInt(s.replace(/[^0-9]/g, '')); return isNaN(n) ? undefined : n; };

    const request = {
      jobUrl: tab === 'url' ? form.jobUrl : undefined,
      jobText: tab === 'paste' ? form.jobText : undefined,
      jobTitle: form.jobTitle.trim() || undefined,
      companyName: form.companyName,
      location: normalizeLocation(form.location),
      postedSalaryMin: toNum(form.postedSalaryMin),
      postedSalaryMax: toNum(form.postedSalaryMax),
      desiredSalaryMin: toNum(form.desiredSalaryMin)!,
      desiredSalaryMax: toNum(form.desiredSalaryMax)!,
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
            Know what they know.
          </span>
        </h1>

        <p className="text-center text-[#8892a4] text-lg max-w-2xl mb-12 leading-relaxed">
          Companies have recruiters, compensation analysts, and years of hiring data. You have a job description and a gut feeling.
          <strong className="text-white"> Not anymore.</strong>
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

              {/* Job title */}
              <div>
                <label className="block text-xs font-medium text-[#8892a4] mb-1.5 uppercase tracking-wide">
                  Job title
                </label>
                <input
                  type="text"
                  value={form.jobTitle}
                  onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))}
                  placeholder="e.g. Head of UX, Senior Software Engineer, VP Marketing..."
                  className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl px-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                />
                <p className="text-[11px] text-[#4a5568] mt-1">Ensures accurate salary benchmarking — recommended, especially when using a URL.</p>
              </div>

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

              {/* Posted salary — optional */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[#8892a4] uppercase tracking-wide">
                    Salary listed in posting
                  </label>
                  <span className="text-[10px] text-[#4a5568]">Optional — leave blank if not listed</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['postedSalaryMin', 'postedSalaryMax'] as const).map((field, i) => (
                    <div key={field} className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8892a4] text-sm">$</span>
                      <input
                        type="text"
                        value={form[field]}
                        onChange={e => setForm(f => ({ ...f, [field]: formatSalary(e.target.value) }))}
                        placeholder={i === 0 ? '80,000' : '100,000'}
                        className="w-full bg-[#0d1117] border border-[#1e2736] rounded-xl pl-7 pr-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Desired salary — required */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-[#8892a4] uppercase tracking-wide">
                    Your desired salary range
                  </label>
                  <span className="text-[10px] text-amber-500/70">Required</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['desiredSalaryMin', 'desiredSalaryMax'] as const).map((field, i) => (
                    <div key={field} className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8892a4] text-sm">$</span>
                      <input
                        type="text"
                        value={form[field]}
                        onChange={e => setForm(f => ({ ...f, [field]: formatSalary(e.target.value) }))}
                        placeholder={i === 0 ? '120,000' : '150,000'}
                        className="w-full bg-[#0d1117] border border-indigo-500/20 rounded-xl pl-7 pr-4 py-3 text-sm text-white placeholder-[#4a5568] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-[#4a5568] mt-1.5">
                  We&apos;ll tell you if this is realistic — and what leverage you actually have.
                </p>
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
                    Running analysis...
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
                Analysis takes 60 seconds · Pulls from thousands of live data points · Built for candidates, never employers
              </p>
            </form>
          </div>
        </div>

        {/* What we uncover */}
        <section id="how" className="w-full max-w-4xl mt-24 px-4">
          <h2 className="text-center text-2xl font-bold text-white mb-2">What we uncover</h2>
          <p className="text-center text-[#8892a4] text-sm mb-12">Every analysis runs live — nothing cached, nothing generic</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '📰', title: 'Company News', desc: '12 months of headlines — layoffs, lawsuits, leadership exits, and anything else that changes the picture before you walk in' },
              { icon: '🗣️', title: 'What Employees Actually Say', desc: 'Unfiltered conversations from career communities across the web — not the polished press releases, the real sentiment' },
              { icon: '⭐', title: 'Company Review Intelligence', desc: 'Rating trends, CEO approval, recurring themes in employee reviews, and what candidates experienced in the interview process' },
              { icon: '💰', title: 'Salary Reality Check', desc: 'Where your offer actually sits in the market — by role, level, and location — not what the company wants you to believe is competitive' },
              { icon: '📋', title: 'Financial Health Signals', desc: 'SEC filings, executive departures, material events — signals that tell you whether this company looks different in 18 months' },
              { icon: '🤖', title: 'Your Verdict', desc: 'Everything synthesized into one honest assessment — red flags ranked, negotiation leverage identified, plain English bottom line' },
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
            { value: '5,000+', label: 'Data points per analysis' },
            { value: '60 seconds', label: 'From submission to full intelligence' },
            { value: '100% candidate-side', label: 'Built for you — never the employer' },
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
