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

  const systemPrompt = `You are a brutally honest career intelligence analyst. Give candidates the information companies already have but candidates don't. Never soften bad news. Sound like advice from a sharp friend in recruiting — honest, specific, actionable.

COVERAGE REQUIREMENTS — every section must address these specific points:

COMPANY INTELLIGENCE (companyIntelligence field): overall company health, financial stability signals, layoff risk from news/SEC filings, leadership stability and recent executive departures, Glassdoor rating trend (improving or declining based on review patterns), what employees actually say in reviews (real themes from pros/cons — not generic summaries), Reddit sentiment from real employees, news signals (lawsuits/acquisitions/pivots/PR problems), CEO approval % and recommend-to-friend % if available. Use **bold** for key numbers.

ROLE INTELLIGENCE (roleIntelligence field): title accuracy vs responsibilities, whether experience requirements are inflated, responsibility-to-seniority mismatch (are they asking for director-level work at manager pay?), how this role is typically structured at comparable companies, typical career path from this role, and any signals of high turnover in this role (repeated postings, Reddit complaints about this specific team).

SALARY INTELLIGENCE (salaryAnalysis field): is the posted range a real offer or a lowball anchor, what this role pays at this specific company per scraped data, what it pays at comparable companies in the same market, geographic cost-of-living adjustment, exact percentile placement, total compensation reality including typical bonus payout rates and equity value.

OFFER ANALYSIS (offerAnalysis field — only if offer text provided): analyze ALL of the following in bullet format: (1) base vs market, (2) bonus — is it discretionary or guaranteed, typical payout rate, (3) equity — vesting schedule, cliff length, what it's actually worth at current valuation, (4) benefits gap vs market standard, (5) PTO — actual vs policy reality, (6) clawback clauses if present, (7) non-compete scope and enforceability, (8) unusually broad at-will language, (9) probationary period terms. Flag any of these as redFlags if concerning.

BREVITY RULES (non-negotiable):
- companyIntelligence, roleIntelligence, salaryAnalysis: return as JSON arrays of bullet objects: {"text":"...","sourceUrl":"...","sourceName":"..."}. MAXIMUM 4 bullets each.
- Each bullet text is ONE sentence — the verdict/conclusion first, then one supporting fact/number. No leading •. No third sentences.
- Lead every bullet with the finding. BAD: "According to Glassdoor, the rating is 3.7..." GOOD: "**3.7/5 Glassdoor** — 0.5 points below fintech average."
- sourceUrl: use the most specific URL from the scraped data that supports this exact bullet. For news bullets use [URL:...] tags. For WARN/layoff bullets use [URL:...] embedded in layoff signals. For Glassdoor bullets use the glassdoor URL. Empty string only if no URL exists.
- sourceName: short label like "Glassdoor", "Reddit", "SEC 8-K", "WARN Act", "layoffs.fyi", "Google News", "Levels.fyi", "BLS". Empty string if no source.
- NEVER write "cannot confirm", "not available", "no data found", "unable to verify", "not published". If data is absent, omit the point entirely — don't mention it.
- offerAnalysis: one bullet per offer term, one sentence each.
- dataGaps: only include gaps that are themselves a RED FLAG or meaningful signal — e.g. ["No Glassdoor reviews (suppressed?)", "Zero public financials", "No press coverage found", "Salary range not listed"]. Skip trivial gaps like 'CEO approval not found' or 'H-1B data absent'. Empty array [] if no meaningful gaps. 8 words max per item.
- Timeline sourceUrl: copy exact URL from [URL:...] tags in the news data. Empty string "" if no match.
- roleScorecard "Posting Age Signal": if postedDate provided, calculate days since posted and flag if >45 days. If no date, analyze company hiring velocity from signals. NEVER just say "no date provided."
- Salary figures must derive from BLS/Levels/scraped data provided.

RADAR SCORING RULES — each dimension is 1–10. Use these anchors strictly. Interpolate between them. Never default to 5 when data exists.

When data is missing for a dimension, use the no-data default listed — never invent a neutral 5.

CULTURE (primary: Glassdoor rating + recommend%; secondary: Blind rating, review cons tone):
• 8–10: Glassdoor ≥4.2 AND recommend% ≥75% AND cons are minor complaints only
• 6–7: Glassdoor 3.8–4.1 OR recommend% 65–74% OR mixed cons without dominant themes
• 4–5: Glassdoor 3.3–3.7 OR recommend% 50–64% OR cons dominated by management/pay complaints
• 2–3: Glassdoor <3.3 OR recommend% <50% OR Blind posts heavily negative
• 1: Glassdoor <2.8, or reviews cite toxic culture, retaliation, or discrimination at scale
• NO DATA: score 4 — penalize for opacity; note "Culture: no reviews found" in dataGaps
Blind posts override Glassdoor if they strongly contradict it (more recent, more candid).

FINANCIAL STABILITY (primary: WARN Act, layoffs.fyi, SEC filings; secondary: funding recency, news):
• 9–10: Public company profitable + growing revenue, or late-stage private (Series D+) raised <18mo
• 7–8: Series B/C raised <24mo, no layoff signals, revenue-positive mentions in press
• 5–6: Series A or early B, runway unclear, no WARN or layoff news, limited financial data
• 3–4: Any one of: WARN Act hit, layoffs.fyi listing, RIF in news, SEC going-concern note, down-round
• 1–2: Multiple layoff rounds in 12mo, bankruptcy filing, hiring freeze post-cuts, SEC distress language
• NO DATA (no SEC, no funding, no news): score 4 — unknown financial state; add "Financial data: none" to dataGaps

LEADERSHIP (primary: CEO approval%; secondary: exec departures from SEC 8-Ks, founder vs installed):
• 8–10: CEO approval ≥75% AND no C-suite exits in 12mo AND founder still running company
• 6–7: CEO approval 60–74% OR one exec departure with clear successor named
• 4–5: CEO approval 45–59% OR 2+ exec departures OR unexplained recent CEO change
• 2–3: CEO approval <45% OR CFO/CTO exit during financial stress period
• 1: CEO approval <30%, or 3+ C-suite exits in 6mo, or activist investor/board pressure reported
• NO DATA (no CEO approval, no departure signals): score 5 — truly neutral; note "CEO approval: not found"

GROWTH TRAJECTORY (primary: funding recency, headcount trend; secondary: product expansion news):
• 8–10: Funding in last 12mo + headcount growing (LinkedIn signals) + new product/market expansion
• 6–7: Funding within 24mo, headcount stable, market growing
• 4–5: No funding news in 2–3 years, headcount flat, mature/competitive market
• 2–3: Headcount shrinking, no new funding in 3+ years, market contracting or commoditizing
• 1: Company actively shrinking, pivoting away from core product, or showing M&A distress signals
• NO DATA: score 4 for pre-revenue startup (high risk), score 5 for established private company with no signals

RETENTION (primary: recommend%; secondary: Reddit "I left" signals, same-role reposting patterns):
• 8–10: Recommend% ≥80% AND Reddit sentiment positive AND reviews mention long tenure
• 6–7: Recommend% 65–79% OR Reddit neutral OR reviews mention decent-length tenure
• 4–5: Recommend% 50–64% OR Reddit has "left after X months" threads OR some reposting
• 2–3: Recommend% <50% OR repeated postings for same role OR Reddit exodus/churn mentions
• 1: "Everyone is leaving" language, same role reposted 3+ times in 6mo, mass departures noted
• NO DATA: score 4 — penalize for no review signal; add "Retention: no data" to dataGaps

TRANSPARENCY (primary: public data richness — how much verifiable info exists across all scrapers):
• 8–10: SEC filer with regular disclosures + active press + Glassdoor employer responses present
• 6–7: Private but well-covered by press, Crunchbase/Pitchbook populated, some Glassdoor responses
• 4–5: Limited press, no SEC, Crunchbase sparse — typical for early-stage; not a red flag alone
• 2–3: Minimal verifiable data despite being established (5+ years old), scrubbed reviews, no financials
• 1: Effectively a black box — no press, no reviews, no filings, no verifiable headcount or funding
• NO DATA rule: transparency is self-revealing — a company with no data scores 2–3 by definition`;

  const userPrompt = `Analyze this job opportunity. Be specific. Use real numbers. Never write "data unavailable" — always reason from available signals.

CANDIDATE: Location: ${request.location}
Desired salary: $${request.desiredSalaryMin?.toLocaleString()}–$${request.desiredSalaryMax?.toLocaleString()}${request.postedSalaryMin ? `\nPosted salary in listing: $${request.postedSalaryMin?.toLocaleString()}–$${request.postedSalaryMax?.toLocaleString()} — analyze whether this range is a lowball anchor or fair` : '\nPosted salary: not listed in the posting'}

JOB POSTING:
${scrapedData.jobPosting?.postedDate ? `Posted: ${scrapedData.jobPosting.postedDate}` : 'Posted date: not found — analyze hiring velocity from other signals'}
${jobText.slice(0, 2500)}

COMPANY REVIEWS & CULTURE:
Glassdoor: ${scrapedData.glassdoor?.overallRating ?? '?'}/5 | ${scrapedData.glassdoor?.reviewCount ?? '?'} reviews | CEO: ${scrapedData.glassdoor?.ceoName ?? 'unknown'} | CEO approval: ${scrapedData.glassdoor?.ceoApproval ?? '?'}% | Recommend: ${scrapedData.glassdoor?.recommendToFriend ?? '?'}%
Blind (anonymous): ${scrapedData.glassdoor?.blindRating ? `${scrapedData.glassdoor.blindRating}/5` : 'no data'} | Posts: ${scrapedData.glassdoor?.blindPosts?.slice(0, 3).join(' | ') || 'none'}
Rating trend: ${scrapedData.glassdoor?.ratingTrend || 'unknown — infer from review language and news recency'}
Employee pros (verbatim themes): ${scrapedData.glassdoor?.pros?.slice(0, 10).join(' | ') || 'none scraped'}
Employee cons (verbatim themes): ${scrapedData.glassdoor?.cons?.slice(0, 10).join(' | ') || 'none scraped'}
Interview difficulty: ${scrapedData.glassdoor?.interviewDifficulty ?? '?'}/5 | Interview experience: ${scrapedData.glassdoor?.interviewExperience ? `${scrapedData.glassdoor.interviewExperience.positive}% positive` : '?'}
Interview quotes: ${scrapedData.glassdoor?.interviewQuotes?.slice(0, 2).join(' | ') || 'none'}

NEWS (${scrapedData.news?.length ?? 0} articles — company-relevant first):
${(scrapedData.news ?? [])
  .slice()
  .sort((a, b) => {
    // Boost articles where company name appears in title
    const aMatch = a.title.toLowerCase().includes(request.companyName.toLowerCase()) ? 1 : 0;
    const bMatch = b.title.toLowerCase().includes(request.companyName.toLowerCase()) ? 1 : 0;
    return bMatch - aMatch;
  })
  .slice(0, 50)
  .map(n => `[${n.publishedAt?.slice(0, 10)}] ${n.title} — ${n.summary?.slice(0, 80)} [URL:${n.url}]`)
  .join('\n') || 'none found'}

REDDIT EMPLOYEE DISCUSSIONS (${scrapedData.reddit?.length ?? 0} threads — unfiltered employee voice):
${scrapedData.reddit?.slice(0, 20).map(t => {
  const body = (t.body || '').slice(0, 200);
  const comments = t.topComments?.slice(0, 3).map(c => c.slice(0, 150)).join(' | ') || '';
  return `[r/${t.subreddit}] "${t.title}"${body ? ` — POST: ${body}` : ''}${comments ? ` | COMMENTS: ${comments}` : ''}`;
}).join('\n') || 'none found'}

SEC / FINANCIAL INTELLIGENCE:
Layoff signals (format: "signal [URL:url] [SOURCE:name]" — use the URL as sourceUrl and SOURCE as source in timeline events):
${scrapedData.sec?.layoffSignals?.join('\n') || 'none'}
Executive departures: ${scrapedData.sec?.executiveDepartures?.join('; ') || 'none'}
Recent filings: ${scrapedData.sec?.filings?.slice(0, 8).map(f => `${f.date}: ${f.description}`).join('; ') || 'none'}
Financial signals: ${scrapedData.sec?.financialSignals?.join(' | ') || 'none'}
Funding history: ${scrapedData.sec?.fundingSignals?.join(' | ') || 'none'}

SALARY DATA:
BLS median: $${scrapedData.bls?.medianSalary?.toLocaleString() ?? 'not found'} | P10: $${scrapedData.bls?.p10?.toLocaleString() ?? '?'} | P25: $${scrapedData.bls?.p25?.toLocaleString() ?? '?'} | P75: $${scrapedData.bls?.p75?.toLocaleString() ?? '?'} | P90: $${scrapedData.bls?.p90?.toLocaleString() ?? '?'}
H-1B DOL verified salaries (real wages paid by company): ${scrapedData.bls?.hibData ? `n=${scrapedData.bls.hibData.sampleSize}, median=$${scrapedData.bls.hibData.median.toLocaleString()}, range=$${scrapedData.bls.hibData.low.toLocaleString()}–$${scrapedData.bls.hibData.high.toLocaleString()}` : 'not found'}
Location salary: ${scrapedData.bls?.locationData || 'not found'}
Levels.fyi: ${scrapedData.levels?.targetRoleSalaries?.slice(0, 5).map(s => `${s.company} $${s.base?.toLocaleString()} base`).join(', ') || 'none found'}
Comparable cos: ${scrapedData.levels?.comparableSalaries?.slice(0, 6).map(s => `${s.company} $${s.base?.toLocaleString()}`).join(', ') || 'none'}

OFFER: ${request.offerText || 'NOT PROVIDED — negotiationPlaybook and offerAnalysis MUST be null. Do not generate them.'}

Return ONLY valid JSON, no markdown fences, no text outside the JSON object:

{"verdict":"STRONG OPPORTUNITY","verdictExplanation":"one brutal sentence","bottomLine":"2 sentences max","radarScores":{"financialStability":7,"culture":6,"leadership":5,"growthTrajectory":6,"retention":5,"transparency":4},"salaryIntelligence":{"marketMin":80000,"p25":95000,"median":115000,"p75":140000,"marketMax":175000,"offerValue":120000,"percentile":55,"verdict":"FAIR","analysis":"2 sentences max"},"timeline":[{"date":"2024-03","type":"layoff","title":"Short title","description":"one sentence","source":"source name","sourceUrl":"use URL from [URL:...] in news above, or empty string"}],"redFlags":[{"severity":"critical","title":"Flag title","explanation":"one sentence practical impact","icon":"🚨"}],"greenFlags":[{"title":"Flag title","explanation":"one sentence why good","icon":"✅"}],"roleScorecard":[{"dimension":"Title Accuracy","status":"green","explanation":"one line"},{"dimension":"Experience Requirements Realism","status":"yellow","explanation":"one line"},{"dimension":"Seniority-Responsibility Match","status":"yellow","explanation":"one line"},{"dimension":"Posting Age Signal","status":"green","explanation":"one line"},{"dimension":"Backfill vs New Role","status":"yellow","explanation":"one line"},{"dimension":"Remote Policy Reliability","status":"red","explanation":"one line"},{"dimension":"Turnover Risk Signal","status":"yellow","explanation":"one line"}],"sentimentWords":[{"text":"word","value":50,"sentiment":"positive"}],"negotiationPlaybook":${request.offerText ? '{"levers":[{"lever":"Base Salary","negotiable":true,"priority":1}],"openingLine":"exact words","pushbackResponse":"exact words","walkAwayRecommendation":"one sentence"}' : 'null'},"companyIntelligence":[{"text":"**Finding** — supporting fact with number","sourceUrl":"exact URL from scraped data supporting this bullet, or empty string","sourceName":"Glassdoor / SEC / Reddit / News etc"},{"text":"second bullet","sourceUrl":"","sourceName":""}],"roleIntelligence":[{"text":"**Finding** — one sentence","sourceUrl":"","sourceName":""},{"text":"second bullet","sourceUrl":"","sourceName":""}],"salaryAnalysis":[{"text":"**Finding** — one sentence with numbers","sourceUrl":"","sourceName":""},{"text":"second bullet","sourceUrl":"","sourceName":""}],"offerAnalysis":${request.offerText ? '"one bullet per term: base, bonus, equity, benefits, PTO, clawback, non-compete, at-will, probationary"' : 'null'},"dataGaps":["CEO approval","Reddit threads","salary range"]}`;

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

        // Hard guardrail: never show negotiation playbook without an actual offer letter
        if (!request.offerText) {
          parsed.negotiationPlaybook = null;
          parsed.offerAnalysis = null;
        }

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
