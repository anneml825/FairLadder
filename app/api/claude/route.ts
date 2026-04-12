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

const FLAG_PHRASES = [
  { phrase: 'wear many hats', explanation: 'Code for understaffed — one person doing multiple jobs without additional pay.', severity: 'yellow' },
  { phrase: 'fast paced', explanation: 'Often signals poor planning, constant firefighting, and unsustainable workloads.', severity: 'yellow' },
  { phrase: 'like a family', explanation: 'Classic manipulation tactic — implies loyalty expectations while obscuring poor work-life boundaries.', severity: 'red' },
  { phrase: 'unlimited pto', explanation: 'Studies consistently show employees take less PTO with this policy. Often no real time-off culture.', severity: 'red' },
  { phrase: 'self starter', explanation: 'May mean minimal onboarding, no mentorship, and you\'ll be left to sink or swim from day one.', severity: 'yellow' },
  { phrase: 'rockstar', explanation: 'Signals immature hiring culture and unrealistic expectations.', severity: 'yellow' },
  { phrase: 'ninja', explanation: 'Same as rockstar. A word that tells you a lot about the culture before you even walk in.', severity: 'yellow' },
  { phrase: 'hustle', explanation: 'Glorification of overwork. Expect long hours as a cultural expectation, not exception.', severity: 'red' },
  { phrase: 'entrepreneurial spirit', explanation: 'Likely means startup-level workload for corporate-level accountability with no equity upside.', severity: 'yellow' },
  { phrase: 'dynamic environment', explanation: 'Often means disorganized, constantly shifting priorities, and leadership that can\'t hold a direction.', severity: 'yellow' },
  { phrase: 'results driven', explanation: 'Vague metric-speak that can justify any demand on your time.', severity: 'grey' },
  { phrase: 'comfortable with ambiguity', explanation: 'Role is likely poorly defined. You may be set up to fail against goals never clearly established.', severity: 'yellow' },
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
  const jobFullText = jobText.toLowerCase();

  const languageWarnings = FLAG_PHRASES
    .filter(fp => jobFullText.includes(fp.phrase))
    .map(fp => ({
      phrase: fp.phrase,
      explanation: fp.explanation,
      severity: fp.severity as 'red' | 'yellow' | 'grey',
    }));

  const systemPrompt = `You are a brutally honest career intelligence analyst. Give candidates information companies already have but candidates don't. Never soften bad news. Call out red flags plainly. Give genuine credit where deserved. Sound like advice from a brilliant friend in recruiting — honest, specific, immediately actionable. Never say "cannot determine" or "data unavailable" — always synthesize from whatever data IS available across all sources. If direct data is missing, reason from the news, Reddit, and Glassdoor signals you do have.`;

  const userPrompt = `Analyze this job opportunity. Be specific. Use real numbers. Never write "data unavailable" — always reason from available signals.

CANDIDATE: Location: ${request.location} | Target salary: $${request.salaryMin?.toLocaleString()}–$${request.salaryMax?.toLocaleString()}

JOB POSTING:
${jobText.slice(0, 2500)}

GLASSDOOR:
Rating: ${scrapedData.glassdoor?.overallRating ?? 'not scraped'}/5 | Reviews: ${scrapedData.glassdoor?.reviewCount ?? '?'} | CEO approval: ${scrapedData.glassdoor?.ceoApproval ?? '?'}% | Recommend: ${scrapedData.glassdoor?.recommendToFriend ?? '?'}%
Pros: ${scrapedData.glassdoor?.pros?.slice(0, 5).join(' | ') || 'none scraped'}
Cons: ${scrapedData.glassdoor?.cons?.slice(0, 5).join(' | ') || 'none scraped'}
Interview difficulty: ${scrapedData.glassdoor?.interviewDifficulty ?? '?'}/5

REDDIT (${scrapedData.reddit?.length ?? 0} threads):
${scrapedData.reddit?.slice(0, 8).map(t => `[r/${t.subreddit}] "${t.title}" (↑${t.score})\n${t.topComments?.slice(0, 2).join(' | ')}`).join('\n') || 'none found'}

NEWS (${scrapedData.news?.length ?? 0} articles):
${scrapedData.news?.slice(0, 10).map(n => `[${n.publishedAt}] ${n.title} — ${n.summary?.slice(0, 120)}`).join('\n') || 'none found'}

SEC FILINGS:
Layoff signals: ${scrapedData.sec?.layoffSignals?.join('; ') || 'none'}
Executive departures: ${scrapedData.sec?.executiveDepartures?.join('; ') || 'none'}
Recent 8-Ks: ${scrapedData.sec?.filings?.slice(0, 4).map(f => `${f.date}: ${f.description}`).join('; ') || 'none'}

SALARY DATA:
BLS median: $${scrapedData.bls?.medianSalary?.toLocaleString() ?? 'not found'} | P10: $${scrapedData.bls?.p10?.toLocaleString() ?? '?'} | P90: $${scrapedData.bls?.p90?.toLocaleString() ?? '?'}
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
            max_tokens: 4096,
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

        const targetSalary = ((request.salaryMin ?? 0) + (request.salaryMax ?? 0)) / 2;

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
  const mid = ((request.salaryMin ?? 0) + (request.salaryMax ?? 0)) / 2;
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
    salaryAnalysis: `BLS median for this occupation type is $${median.toLocaleString()}. Your target range of $${request.salaryMin?.toLocaleString()}–$${request.salaryMax?.toLocaleString()} places you at approximately the ${pct}th percentile.`,
    offerAnalysis: null,
  };
}
