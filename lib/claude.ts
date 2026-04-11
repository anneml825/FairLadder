import Anthropic from '@anthropic-ai/sdk';
import {
  AnalysisRequest,
  AnalysisResult,
  GoogleNewsResult,
  RedditThread,
  GlassdoorData,
  LevelsData,
  BLSData,
  SECData,
  JobPostingData,
  ScrapedSource,
} from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const FLAG_PHRASES = [
  { phrase: 'wear many hats', explanation: 'Code for understaffed — one person doing multiple jobs without additional pay.' },
  { phrase: 'fast paced', explanation: 'Often signals poor planning, constant firefighting, and unsustainable workloads.' },
  { phrase: 'like a family', explanation: 'Classic manipulation tactic — implies loyalty expectations while obscuring poor boundaries.' },
  { phrase: 'unlimited PTO', explanation: 'Studies show employees take less PTO, not more. Often no real time-off culture.' },
  { phrase: 'self starter', explanation: 'May mean minimal onboarding, no mentorship, and you\'ll be left to sink or swim.' },
  { phrase: 'rockstar', explanation: 'Red flag language indicating bro culture and unrealistic expectations.' },
  { phrase: 'ninja', explanation: 'Same as rockstar — signals immature hiring culture and unrealistic expectations.' },
  { phrase: 'hustle', explanation: 'Glorification of overwork. Expect long hours as a cultural expectation, not exception.' },
  { phrase: 'entrepreneurial spirit', explanation: 'Likely means you\'ll do startup-level work for corporate-level accountability.' },
  { phrase: 'dynamic environment', explanation: 'Often means disorganized, constantly changing priorities, poor leadership.' },
  { phrase: 'results driven', explanation: 'Vague metric-speak that can justify any demand on your time and output.' },
  { phrase: 'comfortable with ambiguity', explanation: 'Role may be poorly defined. You\'ll be blamed when unclear goals aren\'t met.' },
];

export async function runClaudeAnalysis(
  request: AnalysisRequest,
  scrapedData: {
    news: GoogleNewsResult[];
    reddit: RedditThread[];
    glassdoor: GlassdoorData;
    levels: LevelsData;
    bls: BLSData;
    sec: SECData;
    jobPosting?: JobPostingData;
  },
  sources: ScrapedSource[]
): Promise<AnalysisResult> {
  const jobText = request.jobText || scrapedData.jobPosting?.fullText || 'Not provided';

  const systemPrompt = `You are a brutally honest career intelligence analyst. Your job is to give candidates the information that companies already have but candidates don't. You are not a cheerleader. You do not soften bad news. You call out red flags plainly and explain what they mean practically. You also give genuine credit where it's deserved. Your analysis should feel like advice from a brilliant friend who works in recruiting and has seen everything — honest, specific, and immediately actionable. Never use corporate language. Never hedge unnecessarily. If something is a red flag say it's a red flag and explain why. If the salary is low say it's low. If the company is struggling say so.`;

  const userPrompt = `Analyze this job opportunity. Score and assess every dimension listed. Be specific. Use actual numbers from the data provided. Do not generalize.

CANDIDATE CONTEXT:
- Location: ${request.location}
- Target salary range: $${request.salaryMin.toLocaleString()} - $${request.salaryMax.toLocaleString()}

JOB POSTING TEXT:
${jobText.slice(0, 3000)}

GLASSDOOR DATA:
- Overall Rating: ${scrapedData.glassdoor.overallRating || 'Not found'}/5
- CEO Approval: ${scrapedData.glassdoor.ceoApproval || 'Not found'}%
- Recommend to Friend: ${scrapedData.glassdoor.recommendToFriend || 'Not found'}%
- Review Count: ${scrapedData.glassdoor.reviewCount || 'Not found'}
- Pros themes: ${scrapedData.glassdoor.pros.slice(0, 5).join(' | ') || 'Not available'}
- Cons themes: ${scrapedData.glassdoor.cons.slice(0, 5).join(' | ') || 'Not available'}
- Interview Difficulty: ${scrapedData.glassdoor.interviewDifficulty || 'Not found'}/5

REDDIT INTELLIGENCE:
${scrapedData.reddit.slice(0, 8).map(t =>
  `[r/${t.subreddit}] "${t.title}" (score: ${t.score})\n${t.topComments.slice(0, 2).join('\n')}`
).join('\n\n') || 'No Reddit data found'}

NEWS INTELLIGENCE:
${scrapedData.news.slice(0, 10).map(n =>
  `[${n.publishedAt}] ${n.title} - ${n.summary}`
).join('\n') || 'No news data found'}

SEC/FINANCIAL DATA:
- Layoff signals: ${scrapedData.sec.layoffSignals.join(', ') || 'None detected'}
- Executive departures: ${scrapedData.sec.executiveDepartures.join(', ') || 'None detected'}
- Recent 8-K filings: ${scrapedData.sec.filings.slice(0, 5).map(f => `${f.date}: ${f.description}`).join(', ') || 'None found'}

SALARY MARKET DATA:
BLS Data:
- Occupation: ${scrapedData.bls.occupationTitle}
- Median salary: $${scrapedData.bls.medianSalary?.toLocaleString() || 'Not found'}
- P10-P90: $${scrapedData.bls.p10?.toLocaleString() || '?'} - $${scrapedData.bls.p90?.toLocaleString() || '?'}

Levels.fyi:
${scrapedData.levels.targetRoleSalaries.slice(0, 3).map(s =>
  `${s.company} ${s.role}: Base $${s.base?.toLocaleString()}, Total $${s.totalComp?.toLocaleString()}`
).join('\n') || 'Limited data'}

Comparable companies:
${scrapedData.levels.comparableSalaries.slice(0, 5).map(s =>
  `${s.company}: Base $${s.base?.toLocaleString()}, Total $${s.totalComp?.toLocaleString()}`
).join('\n') || 'Not available'}

Glassdoor salary: ${scrapedData.glassdoor.salaryData
  ? `$${scrapedData.glassdoor.salaryData.min?.toLocaleString()} - $${scrapedData.glassdoor.salaryData.max?.toLocaleString()} median $${scrapedData.glassdoor.salaryData.median?.toLocaleString()}`
  : 'Not found'}

OFFER DETAILS: ${request.offerText || 'None provided'}

Now produce a comprehensive analysis as a JSON object with EXACTLY this structure:

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
    "offerValue": <number - use midpoint of target salary if no offer>,
    "percentile": <0-100>,
    "verdict": "LOW" | "FAIR" | "STRONG",
    "analysis": "2-3 sentences on salary positioning"
  },

  "timeline": [
    {
      "date": "YYYY-MM",
      "type": "layoff" | "funding" | "leadership" | "lawsuit" | "acquisition" | "rating" | "pivot" | "other",
      "title": "Short title",
      "description": "One sentence description",
      "source": "URL or source name"
    }
  ],

  "redFlags": [
    {
      "severity": "critical" | "watch" | "minor",
      "title": "Short flag title",
      "explanation": "Plain English — what this means for the candidate specifically",
      "icon": "⚠️" | "🔴" | "⚡" | "💸" | "📉" | "🚨"
    }
  ],

  "greenFlags": [
    {
      "title": "Short positive title",
      "explanation": "Why this is genuinely good for the candidate",
      "icon": "✅" | "💚" | "📈" | "🏆" | "💰" | "🌟"
    }
  ],

  "roleScorecard": [
    {
      "dimension": "Title Accuracy",
      "status": "green" | "yellow" | "red",
      "explanation": "One line plain English"
    },
    {
      "dimension": "Experience Requirements Realism",
      "status": "green" | "yellow" | "red",
      "explanation": "One line plain English"
    },
    {
      "dimension": "Posting Age Signal",
      "status": "green" | "yellow" | "red",
      "explanation": "One line plain English"
    },
    {
      "dimension": "Backfill vs New Role",
      "status": "green" | "yellow" | "red",
      "explanation": "One line plain English"
    },
    {
      "dimension": "Remote Policy Reliability",
      "status": "green" | "yellow" | "red",
      "explanation": "One line plain English"
    }
  ],

  "sentimentWords": [
    {
      "text": "word",
      "value": <5-100 size based on frequency>,
      "sentiment": "positive" | "negative" | "neutral"
    }
  ],

  "negotiationPlaybook": <null if no offer, otherwise:> {
    "levers": [
      {
        "lever": "Base Salary",
        "negotiable": true,
        "priority": 1
      }
    ],
    "openingLine": "Exact word-for-word opening negotiation line",
    "pushbackResponse": "Exact word-for-word response to 'this is our best offer'",
    "walkAwayRecommendation": "Clear guidance on when to walk"
  },

  "companyIntelligence": "3-4 paragraphs of detailed company assessment — no corporate speak",
  "roleIntelligence": "2-3 paragraphs on role reality",
  "salaryAnalysis": "2-3 paragraphs on salary positioning",
  "offerAnalysis": <null if no offer, otherwise detailed offer breakdown>
}

Return ONLY valid JSON. No markdown. No explanation outside the JSON.`;

  let rawResponse = '';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    rawResponse = message.content[0].type === 'text' ? message.content[0].text : '';
  } catch (e) {
    console.error('Claude API error:', e);
    rawResponse = getFallbackAnalysis(request, scrapedData);
  }

  // Parse Claude response
  let parsed: Partial<AnalysisResult['radarScores'] extends infer R ? Record<string, unknown> : Record<string, unknown>>;
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]+\}/);
    parsed = JSON.parse(jsonMatch?.[0] || rawResponse);
  } catch {
    parsed = JSON.parse(getFallbackAnalysis(request, scrapedData));
  }

  // Detect language warnings from job posting text
  const jobFullText = (jobText || '').toLowerCase();
  const languageWarnings = FLAG_PHRASES
    .filter(fp => jobFullText.includes(fp.phrase.toLowerCase()))
    .map(fp => ({
      phrase: fp.phrase,
      explanation: fp.explanation,
      severity: (['like a family', 'unlimited PTO', 'hustle'].includes(fp.phrase)
        ? 'red'
        : ['wear many hats', 'fast paced', 'rockstar', 'ninja'].includes(fp.phrase)
          ? 'yellow'
          : 'grey') as 'red' | 'yellow' | 'grey',
    }));

  const analysis = parsed as Record<string, unknown>;

  return {
    id: Math.random().toString(36).slice(2, 10),
    companyName: request.companyName,
    role: scrapedData.jobPosting?.title || 'Position',
    location: request.location,
    analyzedAt: new Date().toISOString(),
    sourcesCount: sources.length,
    sources,
    verdict: (analysis.verdict as AnalysisResult['verdict']) || 'PROCEED WITH CAUTION',
    verdictExplanation: (analysis.verdictExplanation as string) || 'Analysis complete.',
    radarScores: (analysis.radarScores as AnalysisResult['radarScores']) || {
      financialStability: 5, culture: 5, leadership: 5, growthTrajectory: 5, retention: 5, transparency: 5,
    },
    salaryIntelligence: {
      ...((analysis.salaryIntelligence as AnalysisResult['salaryIntelligence']) || {}),
      targetSalary: (request.salaryMin + request.salaryMax) / 2,
    } as AnalysisResult['salaryIntelligence'],
    timeline: (analysis.timeline as AnalysisResult['timeline']) || [],
    redFlags: (analysis.redFlags as AnalysisResult['redFlags']) || [],
    greenFlags: (analysis.greenFlags as AnalysisResult['greenFlags']) || [],
    roleScorecard: (analysis.roleScorecard as AnalysisResult['roleScorecard']) || [],
    languageWarnings,
    sentimentWords: (analysis.sentimentWords as AnalysisResult['sentimentWords']) || [],
    negotiationPlaybook: (analysis.negotiationPlaybook as AnalysisResult['negotiationPlaybook']) || undefined,
    companyIntelligence: (analysis.companyIntelligence as string) || '',
    roleIntelligence: (analysis.roleIntelligence as string) || '',
    salaryAnalysis: (analysis.salaryAnalysis as string) || '',
    offerAnalysis: (analysis.offerAnalysis as string) || undefined,
    bottomLine: (analysis.bottomLine as string) || '',
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
}

function getFallbackAnalysis(request: AnalysisRequest, scrapedData: {
  bls: BLSData;
  glassdoor: GlassdoorData;
}): string {
  const median = scrapedData.bls.medianSalary || 85000;
  const targetMid = (request.salaryMin + request.salaryMax) / 2;
  const percentile = Math.min(99, Math.max(1, Math.round(50 + ((targetMid - median) / median) * 30)));

  return JSON.stringify({
    verdict: 'PROCEED WITH CAUTION',
    verdictExplanation: 'Analysis based on available data. Some sources returned limited results.',
    bottomLine: 'Do your due diligence. The data available suggests a cautious approach.',
    radarScores: {
      financialStability: scrapedData.glassdoor.overallRating ? Math.round(scrapedData.glassdoor.overallRating * 2) : 5,
      culture: scrapedData.glassdoor.overallRating ? Math.round(scrapedData.glassdoor.overallRating * 1.8) : 5,
      leadership: scrapedData.glassdoor.ceoApproval ? Math.round(scrapedData.glassdoor.ceoApproval / 10) : 5,
      growthTrajectory: 5,
      retention: scrapedData.glassdoor.recommendToFriend ? Math.round(scrapedData.glassdoor.recommendToFriend / 10) : 5,
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
      analysis: `Your target of $${targetMid.toLocaleString()} sits at approximately the ${percentile}th percentile for this role based on BLS data.`,
    },
    timeline: [],
    redFlags: [
      {
        severity: 'minor',
        title: 'Limited Data Available',
        explanation: 'Some data sources returned limited results. Verify independently.',
        icon: '⚠️',
      },
    ],
    greenFlags: [],
    roleScorecard: [
      { dimension: 'Title Accuracy', status: 'yellow', explanation: 'Insufficient data to assess title accuracy.' },
      { dimension: 'Experience Requirements Realism', status: 'yellow', explanation: 'Verify requirements match industry norms.' },
      { dimension: 'Posting Age Signal', status: 'yellow', explanation: 'Posting age not determinable.' },
      { dimension: 'Backfill vs New Role', status: 'yellow', explanation: 'Cannot determine from available data.' },
      { dimension: 'Remote Policy Reliability', status: 'yellow', explanation: 'Verify remote policy before accepting.' },
    ],
    sentimentWords: [
      { text: 'opportunity', value: 40, sentiment: 'positive' },
      { text: 'research', value: 30, sentiment: 'neutral' },
      { text: 'caution', value: 35, sentiment: 'negative' },
    ],
    negotiationPlaybook: null,
    companyIntelligence: 'Limited data was returned for this company. Research independently on Glassdoor, LinkedIn, and industry forums before proceeding.',
    roleIntelligence: 'Verify the role requirements and responsibilities match your experience level and career goals.',
    salaryAnalysis: `Based on BLS data, the median salary for this occupation is $${median.toLocaleString()}. Your target range of $${request.salaryMin.toLocaleString()}-$${request.salaryMax.toLocaleString()} should be benchmarked against current market data.`,
    offerAnalysis: null,
  });
}
