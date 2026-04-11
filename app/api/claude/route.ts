import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
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

// Edge runtime supports long streaming responses on Vercel free tier
export const runtime = 'edge';

const FLAG_PHRASES = [
  { phrase: 'wear many hats', explanation: 'Code for understaffed — one person doing multiple jobs without additional pay.', severity: 'yellow' },
  { phrase: 'fast paced', explanation: 'Often signals poor planning, constant firefighting, and unsustainable workloads.', severity: 'yellow' },
  { phrase: 'like a family', explanation: 'Classic manipulation tactic — implies loyalty expectations while obscuring poor work-life boundaries.', severity: 'red' },
  { phrase: 'unlimited PTO', explanation: 'Studies consistently show employees take less PTO with this policy, not more. Often no real time-off culture.', severity: 'red' },
  { phrase: 'self starter', explanation: 'May mean minimal onboarding, no mentorship, and you\'ll be left to sink or swim from day one.', severity: 'yellow' },
  { phrase: 'rockstar', explanation: 'Signals immature hiring culture and unrealistic expectations wrapped in startup bro language.', severity: 'yellow' },
  { phrase: 'ninja', explanation: 'Same as rockstar. A word that tells you a lot about the culture before you even walk in.', severity: 'yellow' },
  { phrase: 'hustle', explanation: 'Glorification of overwork. Expect long hours as a baseline expectation, not an occasional exception.', severity: 'red' },
  { phrase: 'entrepreneurial spirit', explanation: 'Likely means you\'ll do startup-level workload for corporate-level accountability with no equity upside.', severity: 'yellow' },
  { phrase: 'dynamic environment', explanation: 'Often means disorganized, constantly shifting priorities, and leadership that can\'t hold a direction.', severity: 'yellow' },
  { phrase: 'results driven', explanation: 'Vague metric-speak that can be used to justify any demand on your time, then blame you when undefined goals aren\'t met.', severity: 'grey' },
  { phrase: 'comfortable with ambiguity', explanation: 'Role is likely poorly defined. You may be set up to fail against goals that were never clearly established.', severity: 'yellow' },
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

  // Detect language warnings from job posting
  const jobFullText = jobText.toLowerCase();
  const languageWarnings = FLAG_PHRASES
    .filter(fp => jobFullText.includes(fp.phrase.toLowerCase()))
    .map(fp => ({
      phrase: fp.phrase,
      explanation: fp.explanation,
      severity: fp.severity as 'red' | 'yellow' | 'grey',
    }));

  const systemPrompt = `You are a brutally honest career intelligence analyst. Your job is to give candidates the information that companies already have but candidates don't. You are not a cheerleader. You do not soften bad news. You call out red flags plainly and explain what they mean practically. You also give genuine credit where it's deserved. Your analysis should feel like advice from a brilliant friend who works in recruiting and has seen everything — honest, specific, and immediately actionable. Never use corporate language. Never hedge unnecessarily. If something is a red flag say it's a red flag and explain why. If the salary is low say it's low. If the company is struggling say so.`;

  const userPrompt = `Analyze this job opportunity. Score and assess every dimension. Be specific. Use actual numbers. Do not generalize.

CANDIDATE CONTEXT:
- Location: ${request.location}
- Target salary: $${request.salaryMin?.toLocaleString()} - $${request.salaryMax?.toLocaleString()}

JOB POSTING:
${jobText.slice(0, 2500)}

GLASSDOOR DATA:
- Overall Rating: ${scrapedData.glassdoor?.overallRating || 'Not found'}/5
- CEO Approval: ${scrapedData.glassdoor?.ceoApproval || 'Not found'}%
- Recommend to Friend: ${scrapedData.glassdoor?.recommendToFriend || 'Not found'}%
- Review Count: ${scrapedData.glassdoor?.reviewCount || 'Not found'}
- Pros: ${scrapedData.glassdoor?.pros?.slice(0, 4).join(' | ') || 'Not available'}
- Cons: ${scrapedData.glassdoor?.cons?.slice(0, 4).join(' | ') || 'Not available'}

REDDIT INTELLIGENCE:
${scrapedData.reddit?.slice(0, 6).map(t =>
  `[r/${t.subreddit}] "${t.title}" (score: ${t.score})\n${t.topComments?.slice(0, 1).join(' ')}`
).join('\n\n') || 'No Reddit data'}

NEWS SIGNALS:
${scrapedData.news?.slice(0, 8).map(n => `[${n.publishedAt}] ${n.title}`).join('\n') || 'No news data'}

SEC/FINANCIAL:
- Layoff signals: ${scrapedData.sec?.layoffSignals?.join(', ') || 'None'}
- Executive departures: ${scrapedData.sec?.executiveDepartures?.join(', ') || 'None'}
- Recent filings: ${scrapedData.sec?.filings?.slice(0, 3).map(f => `${f.date}: ${f.description}`).join(', ') || 'None'}

SALARY DATA:
- BLS Median: $${scrapedData.bls?.medianSalary?.toLocaleString() || 'Not found'}
- BLS P10-P90: $${scrapedData.bls?.p10?.toLocaleString() || '?'} - $${scrapedData.bls?.p90?.toLocaleString() || '?'}
- Levels.fyi: ${scrapedData.levels?.targetRoleSalaries?.slice(0, 2).map(s => `${s.company} $${s.base?.toLocaleString()} base / $${s.totalComp?.toLocaleString()} total`).join(', ') || 'Limited data'}

OFFER DETAILS: ${request.offerText || 'None provided'}

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation outside JSON):

{
  "verdict": "STRONG OPPORTUNITY" | "PROCEED WITH CAUTION" | "SIGNIFICANT CONCERNS",
  "verdictExplanation": "One brutally honest sentence",
  "bottomLine": "2-3 sentences of honest final verdict",
  "radarScores": {
    "financialStability": <1-10>,
    "culture": <1-10>,
    "leadership": <1-10>,
    "growthTrajectory": <1-10>,
    "retention": <1-10>,
    "transparency": <1-10>
  },
  "salaryIntelligence": {
    "marketMin": <number>,
    "p25": <number>,
    "median": <number>,
    "p75": <number>,
    "marketMax": <number>,
    "offerValue": <number>,
    "percentile": <0-100>,
    "verdict": "LOW" | "FAIR" | "STRONG",
    "analysis": "2-3 sentences on salary positioning"
  },
  "timeline": [
    { "date": "YYYY-MM", "type": "layoff"|"funding"|"leadership"|"lawsuit"|"acquisition"|"rating"|"pivot"|"other", "title": "short title", "description": "one sentence", "source": "source name" }
  ],
  "redFlags": [
    { "severity": "critical"|"watch"|"minor", "title": "short title", "explanation": "plain English practical impact", "icon": "⚠️"|"🔴"|"⚡"|"💸"|"📉"|"🚨" }
  ],
  "greenFlags": [
    { "title": "short title", "explanation": "why this is genuinely good", "icon": "✅"|"💚"|"📈"|"🏆"|"💰"|"🌟" }
  ],
  "roleScorecard": [
    { "dimension": "Title Accuracy", "status": "green"|"yellow"|"red", "explanation": "one line" },
    { "dimension": "Experience Requirements Realism", "status": "green"|"yellow"|"red", "explanation": "one line" },
    { "dimension": "Posting Age Signal", "status": "green"|"yellow"|"red", "explanation": "one line" },
    { "dimension": "Backfill vs New Role", "status": "green"|"yellow"|"red", "explanation": "one line" },
    { "dimension": "Remote Policy Reliability", "status": "green"|"yellow"|"red", "explanation": "one line" }
  ],
  "sentimentWords": [
    { "text": "word", "value": <5-100>, "sentiment": "positive"|"negative"|"neutral" }
  ],
  "negotiationPlaybook": ${request.offerText ? `{
    "levers": [{ "lever": "lever name", "negotiable": true|false, "priority": 1 }],
    "openingLine": "exact word-for-word line",
    "pushbackResponse": "exact word-for-word pushback",
    "walkAwayRecommendation": "clear walk-away guidance"
  }` : 'null'},
  "companyIntelligence": "3-4 paragraphs of detailed honest company assessment",
  "roleIntelligence": "2-3 paragraphs on role reality",
  "salaryAnalysis": "2-3 paragraphs on salary positioning",
  "offerAnalysis": ${request.offerText ? '"detailed offer breakdown"' : 'null'}
}`;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let fullText = '';

        // Stream from Claude
        const claudeStream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 5000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        for await (const chunk of claudeStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullText += chunk.delta.text;
            // Send streaming progress so the UI feels alive
            send({ type: 'thinking', chars: fullText.length });
          }
        }

        // Parse JSON from the completed response
        let parsed: Record<string, unknown>;
        try {
          const jsonMatch = fullText.match(/\{[\s\S]+\}/);
          parsed = JSON.parse(jsonMatch?.[0] || fullText);
        } catch {
          // Fallback if parsing fails
          parsed = buildFallback(request, scrapedData);
        }

        const targetSalary = ((request.salaryMin || 0) + (request.salaryMax || 0)) / 2;

        const result = {
          id: Math.random().toString(36).slice(2, 10),
          companyName: request.companyName,
          role: scrapedData.jobPosting?.title || extractRoleFromText(jobText) || 'Position',
          location: request.location,
          analyzedAt: new Date().toISOString(),
          sourcesCount: sources.length,
          sources,
          languageWarnings,
          ...parsed,
          salaryIntelligence: {
            ...(parsed.salaryIntelligence as Record<string, unknown> || {}),
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Analysis failed';
        send({ type: 'error', message: msg });
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

function extractRoleFromText(text: string): string {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines[0] && lines[0].length < 80) return lines[0].trim();
  return '';
}

function buildFallback(request: AnalysisRequest, scrapedData: { bls: BLSData; glassdoor: GlassdoorData }): Record<string, unknown> {
  const median = scrapedData.bls?.medianSalary || 85000;
  const targetMid = ((request.salaryMin || 0) + (request.salaryMax || 0)) / 2;
  const percentile = Math.min(99, Math.max(1, Math.round(50 + ((targetMid - median) / median) * 30)));

  return {
    verdict: 'PROCEED WITH CAUTION',
    verdictExplanation: 'Analysis complete based on available data. Some sources returned limited results.',
    bottomLine: 'Do additional research before deciding. The data available suggests a cautious approach.',
    radarScores: {
      financialStability: scrapedData.glassdoor?.overallRating ? Math.round(scrapedData.glassdoor.overallRating * 2) : 5,
      culture: scrapedData.glassdoor?.overallRating ? Math.round(scrapedData.glassdoor.overallRating * 1.8) : 5,
      leadership: scrapedData.glassdoor?.ceoApproval ? Math.round(scrapedData.glassdoor.ceoApproval / 10) : 5,
      growthTrajectory: 5,
      retention: scrapedData.glassdoor?.recommendToFriend ? Math.round(scrapedData.glassdoor.recommendToFriend / 10) : 5,
      transparency: 5,
    },
    salaryIntelligence: {
      marketMin: Math.round(median * 0.7),
      p25: Math.round(median * 0.85),
      median,
      p75: Math.round(median * 1.2),
      marketMax: Math.round(median * 1.5),
      offerValue: targetMid,
      percentile,
      verdict: percentile < 40 ? 'LOW' : percentile < 65 ? 'FAIR' : 'STRONG',
      analysis: `Your target of $${targetMid.toLocaleString()} sits near the ${percentile}th percentile based on BLS data.`,
    },
    timeline: [],
    redFlags: [{ severity: 'minor', title: 'Limited Data', explanation: 'Some sources returned limited data. Verify independently.', icon: '⚠️' }],
    greenFlags: [],
    roleScorecard: [
      { dimension: 'Title Accuracy', status: 'yellow', explanation: 'Insufficient data to assess.' },
      { dimension: 'Experience Requirements Realism', status: 'yellow', explanation: 'Verify requirements match industry norms.' },
      { dimension: 'Posting Age Signal', status: 'yellow', explanation: 'Posting age not determinable.' },
      { dimension: 'Backfill vs New Role', status: 'yellow', explanation: 'Cannot determine from available data.' },
      { dimension: 'Remote Policy Reliability', status: 'yellow', explanation: 'Verify policy before accepting.' },
    ],
    sentimentWords: [
      { text: 'opportunity', value: 40, sentiment: 'positive' },
      { text: 'research', value: 30, sentiment: 'neutral' },
      { text: 'caution', value: 35, sentiment: 'negative' },
    ],
    negotiationPlaybook: null,
    companyIntelligence: 'Limited data returned for this company. Research independently on Glassdoor, LinkedIn, and industry forums.',
    roleIntelligence: 'Verify the role requirements and responsibilities match your experience and career goals.',
    salaryAnalysis: `BLS median for this occupation is $${median.toLocaleString()}. Your target of $${targetMid.toLocaleString()} is at the ${percentile}th percentile.`,
    offerAnalysis: null,
  };
}
