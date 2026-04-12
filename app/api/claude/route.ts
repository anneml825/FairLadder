import { NextRequest } from 'next/server';
import {
  AnalysisRequest,
  GoogleNewsResult,
  RedditThread,
  GlassdoorData,
  LevelsData,
  BLSData,
  SECData,
  JobPostingData,
  ScrapedSource,
} from '@/lib/types';

export const runtime = 'edge';

// Each entry can be a plain string (exact) or a regex pattern (flexible matching).
// Normalized job text has hyphens replaced with spaces before matching.
const FLAG_PHRASES: Array<{ phrase: string; pattern?: RegExp; explanation: string; severity: string }> = [
  // ── PACE / URGENCY ───────────────────────────────────────────────────────
  { phrase: 'fast paced', pattern: /fast.?paced/i, explanation: 'Often signals poor planning, constant firefighting, and workloads that erode quality of life within months.', severity: 'yellow' },
  { phrase: 'move fast', explanation: 'Pace-worship culture. Expect decisions made without enough information and cleanup work that never gets prioritized.', severity: 'yellow' },
  { phrase: 'sense of urgency', explanation: 'Everything is urgent — which means nothing is actually prioritized. Expect chronic pressure and unclear triage.', severity: 'yellow' },
  { phrase: 'high velocity', explanation: 'Sounds exciting. Means you\'ll be moving too fast to do things right, and the technical debt is someone else\'s problem.', severity: 'yellow' },
  { phrase: 'hit the ground running', explanation: 'There is no onboarding. You\'re expected to be productive on day one with no ramp time built in.', severity: 'yellow' },
  { phrase: 'aggressive timeline', explanation: 'Deadlines were set before the work was scoped. Expect crunch and broken promises to clients or leadership.', severity: 'red' },
  { phrase: 'deadline-driven', pattern: /deadline.?driven/i, explanation: 'Perpetual deadline pressure is the norm here, not the exception.', severity: 'yellow' },

  // ── WORKLOAD / UNDERSTAFFING ─────────────────────────────────────────────
  { phrase: 'wear many hats', explanation: 'Code for understaffed — one person doing multiple jobs without additional pay or title.', severity: 'yellow' },
  { phrase: 'roll up your sleeves', explanation: 'Management will delegate down. Expect senior people doing junior work when things get tight.', severity: 'yellow' },
  { phrase: 'do more with less', explanation: 'Budget is being cut or has already been cut. Headcount will not grow to match workload.', severity: 'red' },
  { phrase: 'self starter', pattern: /self.?starter/i, explanation: 'Minimal onboarding, no mentorship. You\'ll be left to sink or swim from day one with no structured support.', severity: 'yellow' },
  { phrase: 'multitasking', explanation: 'The role is too broad for one person. Being good at multitasking doesn\'t make this less exhausting.', severity: 'yellow' },
  { phrase: 'above and beyond', explanation: 'Unpaid overtime is an expectation, not a rarity. "Going above and beyond" will be the baseline.', severity: 'red' },
  { phrase: 'bandwidth', explanation: 'You will be at capacity constantly. "Bandwidth" is corporate for "we need more from you."', severity: 'grey' },

  // ── CULTURE RED FLAGS ────────────────────────────────────────────────────
  { phrase: 'like a family', pattern: /like a family|we are a family|we\'re a family/i, explanation: 'Classic manipulation tactic — implies loyalty expectations while obscuring poor work-life boundaries.', severity: 'red' },
  { phrase: 'hustle', explanation: 'Glorification of overwork. Long hours are a cultural expectation, not an exception.', severity: 'red' },
  { phrase: 'entrepreneurial spirit', explanation: 'Startup-level workload for corporate-level accountability — with no equity upside.', severity: 'yellow' },
  { phrase: 'startup culture', explanation: 'Unpredictable hours, unclear roles, and frequent pivots — often with below-market comp justified by "the experience."', severity: 'yellow' },
  { phrase: 'we work hard and play hard', explanation: 'The "play hard" part is optional. The "work hard" part is mandatory and tracked.', severity: 'red' },
  { phrase: 'high performers', explanation: 'Coded language for a competitive internal culture where average performers are quietly managed out.', severity: 'yellow' },
  { phrase: 'rockstar', explanation: 'Signals immature hiring culture and wildly unrealistic expectations.', severity: 'yellow' },
  { phrase: 'ninja', explanation: 'Same signal as rockstar. Tells you how seriously leadership thinks about talent before you walk in.', severity: 'yellow' },
  { phrase: 'guru', explanation: 'Vague, flattering title used to dress up scope creep and unrealistic expectations.', severity: 'yellow' },
  { phrase: 'passionate', explanation: 'Passion rhetoric is used to justify below-market pay. "If you really care, you won\'t negotiate."', severity: 'grey' },
  { phrase: 'mission-driven', explanation: 'The mission may be used to explain why compensation is below market. Ask specifically about pay bands.', severity: 'grey' },

  // ── ROLE DEFINITION / STRUCTURE ──────────────────────────────────────────
  { phrase: 'dynamic environment', explanation: 'Disorganized, constantly shifting priorities, and leadership that can\'t hold a direction for more than a quarter.', severity: 'yellow' },
  { phrase: 'comfortable with ambiguity', explanation: 'Role is poorly defined. You may be set up to fail against goals that were never clearly established.', severity: 'yellow' },
  { phrase: 'results driven', pattern: /results.?driven/i, explanation: 'Vague metric-speak that can justify any demand on your time without clear success criteria.', severity: 'grey' },
  { phrase: 'flat organization', explanation: 'No promotion path. "Flat" often means your only growth option is to leave.', severity: 'yellow' },
  { phrase: 'take ownership', explanation: 'You\'ll be accountable for outcomes you don\'t fully control, with authority that doesn\'t match responsibility.', severity: 'yellow' },
  { phrase: 'own the', explanation: 'Same as "take ownership" — high accountability baked into vague scope.', severity: 'grey' },
  { phrase: 'cross-functional', explanation: 'You\'ll spend significant time navigating organizational politics and competing priorities across teams.', severity: 'grey' },

  // ── COMPENSATION / PTO ───────────────────────────────────────────────────
  { phrase: 'unlimited pto', explanation: 'Research consistently shows employees take less time off with this policy. There is often no real time-off culture.', severity: 'red' },
  { phrase: 'competitive salary', explanation: '"Competitive" is undefined. Ask for a specific band before investing time in the process.', severity: 'grey' },
  { phrase: 'competitive compensation', explanation: 'Same as "competitive salary" — requires you to define what competitive means to you before engaging.', severity: 'grey' },
  { phrase: 'equity upside', explanation: 'Private company equity is often worth less than presented. Ask about liquidation preferences, vesting cliff, and last 409A.', severity: 'grey' },
];

interface ClaudeRequestBody {
  request: AnalysisRequest;
  scrapedData: {
    news: GoogleNewsResult[];
    reddit: RedditThread[];
    glassdoor: GlassdoorData;
    levels: LevelsData;
    bls: BLSData;
    sec: SECData;
    jobPosting?: JobPostingData;
  };
  sources: ScrapedSource[];
}

export async function POST(req: NextRequest) {
  const body: ClaudeRequestBody = await req.json();
  const { request, scrapedData, sources } = body;

  const jobText = request.jobText || scrapedData.jobPosting?.fullText || 'Not provided';
  // Normalize hyphens → spaces so "fast-paced" matches "fast paced"
  const jobFullText = jobText.toLowerCase().replace(/-/g, ' ');

  const languageWarnings = FLAG_PHRASES
    .filter(fp => fp.pattern ? fp.pattern.test(jobFullText) : jobFullText.includes(fp.phrase))
    .map(fp => ({
      phrase: fp.phrase,
      explanation: fp.explanation,
      severity: fp.severity as 'red' | 'yellow' | 'grey',
    }));

  const systemPrompt = `You are a brutally honest career intelligence analyst. Give candidates information companies already have but candidates don't. Never soften bad news. Call out red flags plainly. Give genuine credit where deserved. Sound like advice from a brilliant friend in recruiting — honest, specific, immediately actionable.

FORMATTING RULES — strictly follow these:
- All text fields (companyIntelligence, roleIntelligence, salaryAnalysis, offerAnalysis) must use short paragraphs of 2-3 sentences max, separated by blank lines. Use **bold** for key facts and numbers. Use bullet points (starting with •) for lists of 3+ items. Never write a wall of unbroken text.
- Never say "cannot determine", "data unavailable", or "insufficient data". Always reason from the signals you have.
- All numeric fields in the JSON (radar scores, salary figures, percentiles) must be grounded in the actual scraped data provided. Do not invent numbers. If Glassdoor returned a 3.8 rating, use it. If BLS median is $112,000, use it. If you have no hard number, estimate conservatively and note it is an estimate in the text field, not in the numeric field.
- Radar scores must reflect the actual data: low Glassdoor rating = low culture score, layoff signals = low financial stability, etc. Do not default everything to 5.
- Salary intelligence figures must be derived from BLS and Levels.fyi data provided. Do not fabricate ranges.`;

  const userPrompt = `Analyze this job opportunity. Be specific. Use real numbers. Never write "data unavailable" — always reason from available signals.

CANDIDATE: Location: ${request.location}
Desired salary: $${request.desiredSalaryMin?.toLocaleString()}–$${request.desiredSalaryMax?.toLocaleString()}${request.postedSalaryMin ? `\nPosted salary in listing: $${request.postedSalaryMin?.toLocaleString()}–$${request.postedSalaryMax?.toLocaleString()} — analyze whether this range is a lowball anchor or fair` : '\nPosted salary: not listed in the posting'}

JOB POSTING:
${jobText.slice(0, 2500)}

COMPANY REVIEWS & CULTURE:
Rating: ${scrapedData.glassdoor?.overallRating ?? 'not scraped'}/5 | Reviews: ${scrapedData.glassdoor?.reviewCount ?? '?'} | CEO: ${scrapedData.glassdoor?.ceoName ?? 'unknown'} | CEO approval: ${scrapedData.glassdoor?.ceoApproval ?? '?'}% | Recommend: ${scrapedData.glassdoor?.recommendToFriend ?? '?'}%
Pros: ${scrapedData.glassdoor?.pros?.slice(0, 5).join(' | ') || 'none scraped'}
Cons: ${scrapedData.glassdoor?.cons?.slice(0, 5).join(' | ') || 'none scraped'}
Interview difficulty: ${scrapedData.glassdoor?.interviewDifficulty ?? '?'}/5 | Interview experience: ${scrapedData.glassdoor?.interviewExperience ? `${scrapedData.glassdoor.interviewExperience.positive}% positive` : '?'}
Interview quotes: ${scrapedData.glassdoor?.interviewQuotes?.slice(0, 2).join(' | ') || 'none'}

NEWS (${scrapedData.news?.length ?? 0} articles — most recent first):
${scrapedData.news?.slice(0, 12).map(n => `[${n.publishedAt?.slice(0, 10)}] ${n.title} — ${n.summary?.slice(0, 80)}`).join('\n') || 'none found'}

REDDIT EMPLOYEE DISCUSSIONS (${scrapedData.reddit?.length ?? 0} threads found):
${scrapedData.reddit?.slice(0, 8).map(t => `[r/${t.subreddit}] "${t.title}" — ${(t.body || t.topComments?.[0] || '').slice(0, 120)}`).join('\n') || 'none found'}

SEC / FINANCIAL INTELLIGENCE:
Layoff signals: ${scrapedData.sec?.layoffSignals?.join('; ') || 'none'}
Executive departures: ${scrapedData.sec?.executiveDepartures?.join('; ') || 'none'}
Recent 8-Ks: ${scrapedData.sec?.filings?.slice(0, 4).map(f => `${f.date}: ${f.description}`).join('; ') || 'none'}
Financial signals: ${scrapedData.sec?.financialSignals?.join(' | ') || 'none'}
Funding history: ${scrapedData.sec?.fundingSignals?.join(' | ') || 'none'}

SALARY DATA:
BLS median: $${scrapedData.bls?.medianSalary?.toLocaleString() ?? 'not found'} | P10: $${scrapedData.bls?.p10?.toLocaleString() ?? '?'} | P25: $${scrapedData.bls?.p25?.toLocaleString() ?? '?'} | P75: $${scrapedData.bls?.p75?.toLocaleString() ?? '?'} | P90: $${scrapedData.bls?.p90?.toLocaleString() ?? '?'}
Location salary: ${scrapedData.bls?.locationData || 'not found'}
Levels.fyi: ${scrapedData.levels?.targetRoleSalaries?.slice(0, 3).map(s => `${s.company} $${s.base?.toLocaleString()} base`).join(', ') || 'none found'}
Comparable cos: ${scrapedData.levels?.comparableSalaries?.slice(0, 3).map(s => `${s.company} $${s.base?.toLocaleString()}`).join(', ') || 'none'}

OFFER: ${request.offerText || 'not provided'}

Return ONLY valid JSON, no markdown fences, no text outside the JSON object:

{"verdict":"STRONG OPPORTUNITY","verdictExplanation":"one brutal sentence","bottomLine":"2-3 sentences final honest verdict","radarScores":{"financialStability":7,"culture":6,"leadership":5,"growthTrajectory":6,"retention":5,"transparency":4},"salaryIntelligence":{"marketMin":80000,"p25":95000,"median":115000,"p75":140000,"marketMax":175000,"offerValue":120000,"percentile":55,"verdict":"FAIR","analysis":"2-3 sentence salary assessment"},"timeline":[{"date":"2024-03","type":"layoff","title":"Short title","description":"one sentence","source":"source name"}],"redFlags":[{"severity":"critical","title":"Flag title","explanation":"practical impact for this candidate","icon":"🚨"}],"greenFlags":[{"title":"Flag title","explanation":"why genuinely good","icon":"✅"}],"roleScorecard":[{"dimension":"Title Accuracy","status":"green","explanation":"one line"},{"dimension":"Experience Requirements Realism","status":"yellow","explanation":"one line"},{"dimension":"Posting Age Signal","status":"green","explanation":"one line"},{"dimension":"Backfill vs New Role","status":"yellow","explanation":"one line"},{"dimension":"Remote Policy Reliability","status":"red","explanation":"one line"}],"sentimentWords":[{"text":"word","value":50,"sentiment":"positive"}],"negotiationPlaybook":${request.offerText ? '{"levers":[{"lever":"Base Salary","negotiable":true,"priority":1}],"openingLine":"exact words","pushbackResponse":"exact words","walkAwayRecommendation":"clear guidance"}' : 'null'},"companyIntelligence":"3-4 honest paragraphs","roleIntelligence":"2-3 paragraphs on role reality","salaryAnalysis":"2-3 paragraphs on salary","offerAnalysis":${request.offerText ? '"detailed offer breakdown"' : 'null'}}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Use direct fetch to Anthropic API — the SDK's stream() breaks in Edge runtime
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 8192,
            stream: true,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });

        if (!anthropicRes.ok) {
          const errText = await anthropicRes.text();
          throw new Error(`Anthropic API error ${anthropicRes.status}: ${errText}`);
        }

        if (!anthropicRes.body) throw new Error('No response body from Anthropic');

        // Manually parse Anthropic's SSE stream
        const reader = anthropicRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;

            try {
              const evt = JSON.parse(raw);
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                fullText += evt.delta.text;
                send({ type: 'thinking', chars: fullText.length });
              }
              // message_stop signals completion
              if (evt.type === 'message_stop') {
                break;
              }
            } catch { /* skip malformed lines */ }
          }
        }

        // Extract JSON — handle markdown fences Claude sometimes adds
        let parsed: Record<string, unknown>;
        try {
          // Strip markdown fences if present
          const cleaned = fullText
            .replace(/^```(?:json)?\s*/m, '')
            .replace(/\s*```\s*$/m, '')
            .trim();
          // Find the outermost JSON object
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start === -1 || end === -1) throw new Error('No JSON object found');
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch (parseErr) {
          console.error('JSON parse failed:', parseErr);
          parsed = buildFallback(request, scrapedData);
        }

        const targetSalary = ((request.desiredSalaryMin ?? 0) + (request.desiredSalaryMax ?? 0)) / 2;

        const result = {
          id: Math.random().toString(36).slice(2, 10),
          companyName: request.companyName,
          role: scrapedData.jobPosting?.title || extractRole(jobText) || 'Position',
          location: request.location,
          analyzedAt: new Date().toISOString(),
          sourcesCount: sources.length,
          sources,
          languageWarnings,
          ...parsed,
          salaryIntelligence: {
            ...((parsed.salaryIntelligence as Record<string, unknown>) ?? {}),
            targetSalary,
          },
          rawData: {
            glassdoor: scrapedData.glassdoor,
            reddit: scrapedData.reddit,
            news: scrapedData.news,
            levels: scrapedData.levels,
            bls: scrapedData.bls,
            sec: scrapedData.sec,
            jobPosting: scrapedData.jobPosting,
          },
        };

        send({ type: 'result', data: result });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Analysis failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function extractRole(text: string): string {
  const first = text.split('\n').find(l => l.trim().length > 3 && l.trim().length < 80);
  return first?.trim() ?? '';
}

function buildFallback(
  request: AnalysisRequest,
  scrapedData: { bls: BLSData; glassdoor: GlassdoorData },
): Record<string, unknown> {
  const median = scrapedData.bls?.medianSalary ?? 90000;
  const mid = ((request.desiredSalaryMin ?? 0) + (request.desiredSalaryMax ?? 0)) / 2;
  const pct = Math.min(99, Math.max(1, Math.round(50 + ((mid - median) / median) * 30)));
  return {
    verdict: 'PROCEED WITH CAUTION',
    verdictExplanation: 'Analysis ran with partial data — verify key points independently before deciding.',
    bottomLine: 'The data pipeline returned partial results. Use this as a starting point and research further.',
    radarScores: { financialStability: 5, culture: 5, leadership: 5, growthTrajectory: 5, retention: 5, transparency: 5 },
    salaryIntelligence: {
      marketMin: Math.round(median * 0.7), p25: Math.round(median * 0.85), median,
      p75: Math.round(median * 1.2), marketMax: Math.round(median * 1.5),
      offerValue: mid, percentile: pct,
      verdict: pct < 40 ? 'LOW' : pct < 65 ? 'FAIR' : 'STRONG',
      analysis: `Your target of $${mid.toLocaleString()} sits at the ${pct}th percentile based on BLS data.`,
    },
    timeline: [],
    redFlags: [{ severity: 'minor', title: 'Partial Data', explanation: 'Some sources returned limited data. Cross-check independently.', icon: '⚠️' }],
    greenFlags: [],
    roleScorecard: [
      { dimension: 'Title Accuracy', status: 'yellow', explanation: 'Verify against industry norms.' },
      { dimension: 'Experience Requirements Realism', status: 'yellow', explanation: 'Compare against similar postings.' },
      { dimension: 'Posting Age Signal', status: 'yellow', explanation: 'Check how long the role has been listed.' },
      { dimension: 'Backfill vs New Role', status: 'yellow', explanation: 'Ask the recruiter directly.' },
      { dimension: 'Remote Policy Reliability', status: 'yellow', explanation: 'Confirm in writing before accepting.' },
    ],
    sentimentWords: [
      { text: 'opportunity', value: 40, sentiment: 'positive' },
      { text: 'uncertain', value: 35, sentiment: 'negative' },
      { text: 'research', value: 30, sentiment: 'neutral' },
    ],
    negotiationPlaybook: null,
    companyIntelligence: `Limited automated data was returned for ${request.companyName}. Search Glassdoor, LinkedIn, and Blind manually for current employee sentiment.`,
    roleIntelligence: 'Verify the scope and seniority of this role against comparable postings at similar companies.',
    salaryAnalysis: `BLS median for this occupation type is $${median.toLocaleString()}. Your desired range of $${request.desiredSalaryMin?.toLocaleString()}–$${request.desiredSalaryMax?.toLocaleString()} places you at approximately the ${pct}th percentile.`,
    offerAnalysis: null,
  };
}
