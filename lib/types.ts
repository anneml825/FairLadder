export interface CompanyFactsData {
  isPublic: boolean;
  employeeCount?: number;
  employeeCountPriorYear?: number;
  revenue?: number;
  revenuePriorYear?: number;
  netIncome?: number;
  cashOnHand?: number;
  longTermDebt?: number;
  filingYear?: string;
}

export interface CourtCase {
  title: string;
  court: string;
  dateFiled: string;
  caseType: 'employment' | 'wage' | 'discrimination' | 'securities' | 'other';
  url: string;
  snippet?: string;
}

export interface GitHubData {
  orgHandle?: string;
  publicRepos?: number;
  recentlyActive?: boolean;
  lastPushDate?: string;
  topLanguages?: string[];
  totalStars?: number;
}

export interface LCARecord {
  jobTitle: string;
  annualWageFrom: number;
  annualWageTo: number | null;
  city: string;
  state: string;
  decisionDate: string;
}

export interface LCAData {
  sampleSize: number;
  wageMin: number;
  wageMedian: number;
  wageMax: number;
  topRoles: Array<{ title: string; count: number; medianWage: number }>;
  recentRecords: LCARecord[];
}

export interface EnrichmentData {
  companyFacts?: CompanyFactsData;
  courtCases?: CourtCase[];
  github?: GitHubData;
  nlrbSignals?: string[];
  oshaSignals?: string[];
  lca?: LCAData;
}

export interface AnalysisRequest {
  jobUrl?: string;
  jobText?: string;
  jobTitle?: string;
  companyName: string;
  location: string;
  // What the posting advertises (optional — many jobs don't list it)
  postedSalaryMin?: number;
  postedSalaryMax?: number;
  // What the candidate wants
  desiredSalaryMin: number;
  desiredSalaryMax: number;
  offerText?: string;
}

export interface ScrapedSource {
  url: string;
  type: 'google-news' | 'reddit' | 'glassdoor' | 'levels' | 'bls' | 'sec' | 'job-posting' | 'crunchbase';
  title: string;
  timestamp: string;
}

export interface GoogleNewsResult {
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  source: string;
}

export interface RedditThread {
  title: string;
  url: string;
  subreddit: string;
  score: number;
  commentCount: number;
  topComments: string[];
  body?: string;
}

export interface GlassdoorData {
  overallRating: number | null;
  ratingTrend: string;
  ceoApproval: number | null;
  recommendToFriend: number | null;
  pros: string[];
  cons: string[];
  salaryData?: { role: string; min: number; max: number; median: number } | null;
  interviewDifficulty: number | null;
  interviewExperience: { positive: number; neutral: number; negative: number } | null;
  reviewCount: number | null;
  ceoName?: string;
  interviewQuotes?: string[];
  blindRating?: number | null;
  blindPosts?: string[];
}

export interface LevelsData {
  targetRoleSalaries: Array<{
    company: string;
    role: string;
    base: number;
    totalComp: number;
    equity?: string;
    location: string;
  }>;
  comparableSalaries: Array<{
    company: string;
    base: number;
    totalComp: number;
  }>;
}

export interface BLSData {
  occupationTitle: string;
  medianSalary: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  yearOverYearChange: string;
  locationData?: string;
  hibData?: { median: number; sampleSize: number; low: number; high: number };
}

export interface SECData {
  filings: Array<{
    date: string;
    type: string;
    description: string;
    url: string;
  }>;
  layoffSignals: string[];
  executiveDepartures: string[];
  fundingSignals: string[];
  financialSignals: string[];
}

export interface JobPostingData {
  title: string;
  company: string;
  location: string;
  salaryRange?: { min: number; max: number } | null;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  remotePolicy: string;
  postedDate?: string;
  fullText: string;
  isRepost: boolean;
}

export interface ScrapeProgress {
  step: string;
  status: 'pending' | 'running' | 'done' | 'error';
  count?: number;
  message?: string;
}

export interface RadarScore {
  financialStability: number;
  culture: number;
  leadership: number;
  growthTrajectory: number;
  retention: number;
  transparency: number;
}

export interface Flag {
  severity: 'critical' | 'watch' | 'minor';
  title: string;
  explanation: string;
  icon: string;
}

export interface GreenFlag {
  title: string;
  explanation: string;
  icon: string;
}

export interface TimelineEvent {
  date: string;
  type: 'layoff' | 'funding' | 'leadership' | 'lawsuit' | 'acquisition' | 'rating' | 'pivot' | 'other';
  title: string;
  description: string;
  source?: string;
  sourceUrl?: string;
}

export interface SalaryIntelligence {
  marketMin: number;
  p25: number;
  median: number;
  p75: number;
  marketMax: number;
  offerValue: number;
  percentile: number;
  verdict: 'LOW' | 'FAIR' | 'STRONG';
  targetSalary: number;
  /** Set when using an adjacent/comparable role instead of direct market data */
  dataNote?: string;
  /** One-sentence Claude summary of this salary position, e.g. "Your target is 12% above market median for this role in Seattle." */
  analysis?: string;
}

export interface RoleScorecardRow {
  dimension: string;
  status: 'green' | 'yellow' | 'red';
  explanation: string;
}

export interface SentimentWord {
  text: string;
  value: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface NegotiationPlaybook {
  levers: Array<{
    lever: string;
    negotiable: boolean;
    priority: number;
  }>;
  openingLine: string;
  pushbackResponse: string;
  walkAwayRecommendation: string;
}

export interface IntelligenceBullet {
  text: string;         // markdown-formatted bullet text (no leading •)
  sourceUrl?: string;   // direct link to the source supporting this bullet
  sourceName?: string;  // short display name, e.g. "Glassdoor", "SEC 8-K", "WARN Act"
}

export interface AnalysisResult {
  id: string;
  companyName: string;
  role: string;
  location: string;
  analyzedAt: string;
  sourcesCount: number;
  sources: ScrapedSource[];

  verdict: 'STRONG OPPORTUNITY' | 'PROCEED WITH CAUTION' | 'SIGNIFICANT CONCERNS';
  verdictExplanation: string;

  radarScores: RadarScore;
  salaryIntelligence: SalaryIntelligence;
  timeline: TimelineEvent[];
  redFlags: Flag[];
  greenFlags: GreenFlag[];
  roleScorecard: RoleScorecardRow[];
  languageWarnings: Array<{ phrase: string; explanation: string; severity: 'red' | 'yellow' | 'grey' }>;
  sentimentWords: SentimentWord[];
  negotiationPlaybook?: NegotiationPlaybook;

  companyIntelligence: IntelligenceBullet[] | string;
  roleIntelligence: IntelligenceBullet[] | string;
  salaryAnalysis: IntelligenceBullet[] | string;
  offerAnalysis?: string;
  dataGaps?: string[];
  bottomLine: string;
  nlrbSummary?: string;
  oshaSummary?: string;

  rawData: {
    glassdoor?: GlassdoorData;
    reddit?: RedditThread[];
    news?: GoogleNewsResult[];
    levels?: LevelsData;
    bls?: BLSData;
    sec?: SECData;
    jobPosting?: JobPostingData;
    enrichment?: EnrichmentData;
  };
}
