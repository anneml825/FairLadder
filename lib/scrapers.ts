import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  GoogleNewsResult,
  RedditThread,
  GlassdoorData,
  LevelsData,
  BLSData,
  SECData,
  JobPostingData,
  ScrapedSource,
  CompanyFactsData,
  CourtCase,
  GitHubData,
  EnrichmentData,
  LCAData,
  LCARecord,
} from './types';
import { getCachedQuery, setCachedQuery, getSupabaseClient } from './cache';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
};

// ── SERPER.DEV ───────────────────────────────────────────────────────────────
// Primary search API — 2,500 free searches, no credit card needed.

async function searchSerper(query: string, num = 10): Promise<SerpResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  // Check Supabase cache first — saves Serper quota on repeat queries
  const cacheKey = `${query}|n=${num}`;
  const cached = await getCachedQuery(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num },
      { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, timeout: 12000 },
    );
    const results: Array<{ title?: string; link?: string; snippet?: string }> = res.data?.organic ?? [];
    const mapped = results
      .filter(r => r.link && r.title)
      .map(r => ({ title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' }));

    // Persist to cache asynchronously — don't await so it doesn't slow the response
    void setCachedQuery(cacheKey, mapped);

    return mapped;
  } catch (e: unknown) {
    console.error('Serper error:', (e as { message: string }).message);
    return [];
  }
}

// ── SERPAPI ──────────────────────────────────────────────────────────────────
// Real Google search results via SerpAPI. Key is optional — all callers fall
// back gracefully if SERPAPI_KEY is not set.

interface SerpResult { title: string; link: string; snippet: string; }

async function searchSerp(query: string, num = 10): Promise<SerpResult[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const url = `https://serpapi.com/search.json?api_key=${key}&q=${encodeURIComponent(query)}&num=${num}&hl=en&gl=us`;
    const res = await axios.get(url, { timeout: 12000 });
    const results: Array<{ title?: string; link?: string; snippet?: string }> = res.data?.organic_results ?? [];
    return results
      .filter(r => r.link && r.title)
      .map(r => ({ title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' }));
  } catch (e: unknown) {
    console.error('SerpAPI error:', (e as { message: string }).message);
    return [];
  }
}

async function fetchHtml(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, ...extraHeaders },
      timeout: 15000,
      maxRedirects: 5,
    });
    return res.data as string;
  } catch (e: unknown) {
    const err = e as { message: string };
    console.error(`Fetch failed for ${url}: ${err.message}`);
    return '';
  }
}

// ── GOOGLE NEWS ──────────────────────────────────────────────────────────────
export async function scrapeGoogleNews(
  companyName: string,
  role?: string,
  companyContext?: string
): Promise<{ results: GoogleNewsResult[]; sources: ScrapedSource[] }> {
  const results: GoogleNewsResult[] = [];
  const sources: ScrapedSource[] = [];
  const seenUrls = new Set<string>();

  // Build disambiguated company query — for generic names like "Meridian", appending context
  // (e.g. "AI startup") prevents matching Meridian Idaho, Meridian IT, Le Meridian hotel, etc.
  const ctxSuffix = companyContext ? ` ${companyContext}` : '';
  const companyQ = `"${companyName}"${ctxSuffix}`;

  const queries = [
    `${companyQ} layoffs OR "job cuts" OR "reduction in force" OR downsizing OR restructuring`,
    `${companyQ} acquisition OR merger OR IPO OR "going public" OR bankruptcy OR valuation OR funding OR "Series"`,
    `${companyQ} earnings OR revenue OR profit OR "quarterly results" OR "financial results"`,
    `${companyQ} CEO OR CFO OR CTO OR "executive departure" OR resignation OR leadership`,
    `${companyQ} lawsuit OR investigation OR fine OR regulatory OR fraud OR NLRB`,
    `${companyQ} employees OR culture OR "work environment" OR glassdoor OR "employee reviews"`,
  ];

  // Only add role query when role is a real job title (not a company tagline)
  if (role && role.length > 3 && role.length < 60 && !/connecting|talent|opportunity|markets/i.test(role)) {
    queries.push(`${companyQ} "${role}" salary OR compensation OR hiring`);
  }

  // Keyword that must appear in title to keep the article — prevents off-topic noise.
  const companyWords = companyName.split(/\s+/).filter(w => w.length >= 4);
  const anchor = companyWords.sort((a, b) => b.length - a.length)[0]?.toLowerCase() || companyName.toLowerCase();

  // Fetch all RSS feeds in parallel (was sequential — caused timeouts)
  const xmlResults = await Promise.all(
    queries.map(q =>
      fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`)
    )
  );

  for (const xml of xmlResults) {
    if (!xml || xml.length < 100) continue;

    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();
      const source = $(el).find('source').text().trim();
      const description = $(el).find('description').text().replace(/<[^>]*>/g, '').trim().slice(0, 300);

      if (!title || !link || seenUrls.has(link)) return;
      if (!title.toLowerCase().includes(anchor)) return;

      seenUrls.add(link);
      results.push({ title, url: link, summary: description, publishedAt: pubDate, source: source || 'Google News' });
      sources.push({ url: link, type: 'google-news', title, timestamp: pubDate || new Date().toISOString() });
    });
  }

  return { results: results.slice(0, 50), sources: sources.slice(0, 50) };
}

// ── REDDIT ───────────────────────────────────────────────────────────────────
// Use Reddit's native search.json API with a bot-identifying User-Agent.
// Reddit is more permissive with the proper UA format than DDG Lite which
// blocks datacenter IPs outright. Google News RSS is the fallback.

const REDDIT_UA = 'server:fairladder-job-analysis:1.0 (job research tool)';
const REDDIT_URL_RE = /https?:\/\/(?:www\.)?reddit\.com\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+\/[^"'\s<>&]*/g;

function extractRedditThreads(
  xml: string,
  seen: Set<string>,
  threads: RedditThread[],
  sources: ScrapedSource[],
) {
  // For Google News RSS XML, extract any embedded reddit.com URLs
  const rawUrls = [...new Set((xml.match(REDDIT_URL_RE) || []).map(u => u.replace(/\/$/, '')))];
  const $ = cheerio.load(xml, { xmlMode: true });
  $('item').each((_, el) => {
    const link = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
    const title = $(el).find('title').text().trim();
    if (link && REDDIT_URL_RE.test(link)) rawUrls.push(link.replace(/\/$/, ''));
    REDDIT_URL_RE.lastIndex = 0;
    // description may contain reddit URLs
    const desc = $(el).find('description').text();
    const inDesc = desc.match(REDDIT_URL_RE) || [];
    rawUrls.push(...inDesc.map(u => u.replace(/\/$/, '')));
    if (title && link) { /* title available if needed */ }
  });
  for (const url of [...new Set(rawUrls)]) {
    if (seen.has(url)) continue;
    seen.add(url);
    const subredditM = url.match(/reddit\.com\/r\/([^/]+)/);
    const slug = url.split('/').slice(-1)[0].replace(/_/g, ' ');
    threads.push({ title: slug.slice(0, 200), url, subreddit: subredditM?.[1] || 'reddit', score: 0, commentCount: 0, topComments: [], body: '' });
    sources.push({ url, type: 'reddit', title: slug.slice(0, 120), timestamp: new Date().toISOString() });
  }
}

async function fetchRedditSearch(
  query: string,
  subreddit?: string,
  sort: 'relevance' | 'top' = 'relevance',
  t: 'year' | 'all' = 'year',
): Promise<Array<{ title: string; url: string; subreddit: string; score: number; num_comments: number; selftext: string }>> {
  try {
    const base = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json`
      : `https://www.reddit.com/search.json`;
    const params = new URLSearchParams({ q: query, sort, t, limit: '10', ...(subreddit ? { restrict_sr: '1' } : {}) });
    const res = await axios.get(`${base}?${params}`, {
      headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
      timeout: 10000,
    });
    type RedditChild = { data: { title: string; permalink: string; subreddit: string; score: number; num_comments: number; selftext: string } };
    const children: RedditChild[] = res.data?.data?.children ?? [];
    return children.map(c => ({
      title: c.data.title ?? '',
      url: `https://www.reddit.com${c.data.permalink}`,
      subreddit: c.data.subreddit ?? '',
      score: c.data.score ?? 0,
      num_comments: c.data.num_comments ?? 0,
      selftext: c.data.selftext ?? '',
    }));
  } catch { return []; }
}

export async function scrapeReddit(
  companyName: string,
  role: string,
  companyContext?: string,
): Promise<{ threads: RedditThread[]; sources: ScrapedSource[] }> {
  const threads: RedditThread[] = [];
  const sources: ScrapedSource[] = [];
  const seen = new Set<string>();

  const addPost = (p: { title: string; url: string; subreddit: string; score: number; num_comments: number; selftext: string }) => {
    if (seen.has(p.url)) return;
    seen.add(p.url);
    threads.push({ title: p.title, url: p.url, subreddit: p.subreddit, score: p.score, commentCount: p.num_comments, topComments: [], body: p.selftext.slice(0, 400) });
    sources.push({ url: p.url, type: 'reddit', title: p.title.slice(0, 120), timestamp: new Date().toISOString() });
  };

  // Build disambiguated query — prevents "Meridian" from matching Meridian Idaho, Meridian IT, etc.
  const ctx = companyContext ? ` ${companyContext}` : '';
  const companyQ = `"${companyName}"${ctx}`;

  const serpQueries = [
    `site:reddit.com ${companyQ} employees culture work experience`,
    `site:reddit.com ${companyQ} salary compensation pay`,
    `site:reddit.com ${companyQ} interview hiring layoffs`,
    `${companyQ} reddit employees culture review`,
    // Unquoted fallbacks — find "StoneX Group" threads when user typed "StoneX"
    `site:reddit.com ${companyName} employees culture work`,
    `${companyName} reddit salary work experience review`,
    role && role.length < 60
      ? `site:reddit.com ${companyQ} "${role}"`
      : `${companyQ} reddit salary career`,
  ];

  // All Serper queries fire at once
  const serpResultSets = await Promise.all(serpQueries.map(q => searchWeb(q, 6)));

  // Dedupe and collect unique Reddit thread URLs
  const candidateUrls: Array<{ link: string; title: string; snippet: string }> = [];
  for (const results of serpResultSets) {
    for (const r of results) {
      if (r.link.includes('reddit.com/r/') && !seen.has(r.link)) {
        seen.add(r.link);
        candidateUrls.push(r);
      }
    }
  }

  // Fetch all thread .json endpoints IN PARALLEL with a short timeout (was 8s sequential per thread)
  type RedditJsonPost = { data: { selftext?: string } };
  type RedditJsonComment = { data: { body?: string; score?: number } };

  await Promise.all(candidateUrls.slice(0, 12).map(async (r) => {
    const subredditM = r.link.match(/reddit\.com\/r\/([^/]+)/);
    let body = r.snippet;
    let topComments: string[] = [];
    try {
      const jsonUrl = r.link.replace(/\/$/, '') + '.json?limit=4';
      const jsonRes = await axios.get(jsonUrl, {
        headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
        timeout: 4000,   // short — we're running in parallel so a slow one doesn't block others
      });
      const postData: RedditJsonPost = jsonRes.data?.[0]?.data?.children?.[0] ?? {};
      body = postData.data?.selftext?.slice(0, 600) || r.snippet;
      const comments: RedditJsonComment[] = jsonRes.data?.[1]?.data?.children ?? [];
      topComments = comments
        .filter(c => c.data?.body && c.data.body !== '[deleted]')
        .slice(0, 3)
        .map(c => (c.data.body ?? '').slice(0, 200));
    } catch { /* use snippet as body */ }
    threads.push({ title: r.title, url: r.link, subreddit: subredditM?.[1] || 'reddit', score: 0, commentCount: 0, topComments, body });
    sources.push({ url: r.link, type: 'reddit', title: r.title.slice(0, 120), timestamp: new Date().toISOString() });
  }));

  // Fallback: Reddit's native search API + key subreddits — runs in parallel if Serper found < 5
  if (threads.length < 5) {
    const nativeQueries = [
      `"${companyName}" employees culture work`,
      `"${companyName}" salary compensation pay`,
      `"${companyName}" layoffs interview hiring`,
      role ? `"${companyName}" "${role}"` : `"${companyName}" career`,
    ];
    const subreddits = ['cscareerquestions', 'jobs', 'careerguidance', 'finance',
      'financialcareers', 'investing', 'ExperiencedDevs', 'personalfinance', 'AskHR'];
    const allNative = await Promise.all([
      ...nativeQueries.map(q => fetchRedditSearch(q)),
      ...subreddits.map(sub => fetchRedditSearch(`"${companyName}"`, sub)),
      // Top-sorted all-time pass — catches high-value older posts not surfaced by recency
      ...nativeQueries.slice(0, 2).map(q => fetchRedditSearch(q, undefined, 'top', 'all')),
    ]);
    allNative.flat().forEach(addPost);
  }

  // Google News RSS — catches Reddit threads indexed via news (runs in parallel)
  const rssUrls = [
    `https://news.google.com/rss/search?q=${encodeURIComponent(`"${companyName}" site:reddit.com`)}&hl=en-US&gl=US&ceid=US:en`,
    `https://news.google.com/rss/search?q=${encodeURIComponent(`"${companyName}" reddit employees`)}&hl=en-US&gl=US&ceid=US:en`,
  ];
  const rssResults = await Promise.all(rssUrls.map(u => fetchHtml(u)));
  rssResults.forEach(xml => { if (xml) extractRedditThreads(xml, seen, threads, sources); });

  return { threads: threads.slice(0, 30), sources };
}

// ── GOOGLE CUSTOM SEARCH ─────────────────────────────────────────────────────
// Used for Glassdoor/Comparably/salary searches. 100 queries/day free.
// Requires GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX env vars.

async function searchGoogle(query: string, num = 10): Promise<SerpResult[]> {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) return [];
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(num, 10)}`;
    const res = await axios.get(url, { timeout: 12000 });
    const items: Array<{ title?: string; link?: string; snippet?: string }> = res.data?.items ?? [];
    return items
      .filter(r => r.link && r.title)
      .map(r => ({ title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' }));
  } catch (e: unknown) {
    console.error('Google CSE error:', (e as { message: string }).message);
    return [];
  }
}

// Unified web search — Serper.dev first (2,500 free), SerpAPI fallback (100/mo), then Google CSE
async function searchWeb(query: string, num = 10): Promise<SerpResult[]> {
  if (process.env.SERPER_API_KEY) return searchSerper(query, num);
  if (process.env.SERPAPI_KEY) return searchSerp(query, num);
  if (process.env.GOOGLE_SEARCH_API_KEY) return searchGoogle(query, num);
  return [];
}

// ── GLASSDOOR ────────────────────────────────────────────────────────────────

const GLASSDOOR_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

async function fetchGlassdoor(url: string): Promise<string> {
  const ua = GLASSDOOR_UAS[Math.floor(Math.random() * GLASSDOOR_UAS.length)];
  await new Promise(r => setTimeout(r, 800 + Math.random() * 600));
  return fetchHtml(url, {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
  });
}

// Extract Apollo GraphQL state embedded in Glassdoor pages as window.__INITIAL_STATE__.apolloState
// The full company object lives under keys like "Employer:12345" in this JSON blob.
function extractApolloState(html: string): Record<string, unknown> | null {
  const idx = html.indexOf('"apolloState":');
  if (idx === -1) return null;
  const start = html.indexOf('{', idx);
  if (start === -1) return null;
  // Walk balanced braces — more robust than a greedy regex across minified JS
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}

function parseGlassdoorHtml(html: string, data: GlassdoorData, url: string, sources: ScrapedSource[], companyName: string) {
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // Rating — try many selectors + regex fallback on raw text
  const ratingSelectors = ['.rating-headline-average', '.ratingNum', '[data-test="rating"]',
    '.css-1pmc6te', '.e1rrn5ka2', '[class*="ratingNumber"]', '[class*="RatingNumber"]'];
  for (const sel of ratingSelectors) {
    const val = parseFloat($(sel).first().text().trim());
    if (!isNaN(val) && val >= 1 && val <= 5) { data.overallRating = val; break; }
  }
  if (!data.overallRating) {
    const m = bodyText.match(/(\d\.\d)\s*(?:out of 5|\/5|\s*stars?)/i);
    if (m) data.overallRating = parseFloat(m[1]);
  }

  // Review count
  const rcMatch = bodyText.match(/([\d,]+)\s*reviews?/i);
  if (rcMatch) data.reviewCount = parseInt(rcMatch[1].replace(/,/g, ''));

  // CEO approval %
  const ceoMatch = bodyText.match(/(\d+)%\s*(?:approve|approval)/i);
  if (ceoMatch) data.ceoApproval = parseInt(ceoMatch[1]);

  // Recommend %
  const recMatch = bodyText.match(/(\d+)%\s*(?:would recommend|recommend to a friend)/i);
  if (recMatch) data.recommendToFriend = parseInt(recMatch[1]);

  // Pros / cons
  $('[data-test="pros"], [class*="pros"], .gdReview .pros').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 10) data.pros.push(t.slice(0, 200));
  });
  $('[data-test="cons"], [class*="cons"], .gdReview .cons').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 10) data.cons.push(t.slice(0, 200));
  });

  sources.push({ url, type: 'glassdoor', title: `${companyName} - Glassdoor`, timestamp: new Date().toISOString() });
}

export async function scrapeGlassdoor(
  companyName: string,
  role: string,
  companyContext?: string,
): Promise<{ data: GlassdoorData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: GlassdoorData = {
    overallRating: null, ratingTrend: 'Unknown', ceoApproval: null,
    recommendToFriend: null, pros: [], cons: [], salaryData: null,
    interviewDifficulty: null, interviewExperience: null, reviewCount: null,
  };

  const ctx = companyContext ? ` ${companyContext}` : '';
  const companyQ = `"${companyName}"${ctx}`;

  const glassdoorSearches = [
    `${companyQ} glassdoor reviews rating culture employees`,
    `site:glassdoor.com ${companyQ} reviews`,
    // Unquoted fallback — catches "StoneX Group" when user typed "StoneX"
    `site:glassdoor.com ${companyName} reviews employees`,
    `${companyName} glassdoor rating reviews 2024`,
  ];
  let glassdoorDirectUrl: string | null = null;

  for (const q of glassdoorSearches) {
    const reviewSearchResults = await searchWeb(q, 10);
    for (const r of reviewSearchResults) {
      const lower = r.link.toLowerCase();
      const combinedText = `${r.title} ${r.snippet}`;

      // Extract rating from snippet (Google caches the rating in meta description)
      if (!data.overallRating) {
        const rM = combinedText.match(/(\d\.\d)\s*(?:out of 5|stars?|\/5)/i);
        if (rM) data.overallRating = parseFloat(rM[1]);
      }
      if (!data.ceoApproval) {
        const ceoM = combinedText.match(/(\d+)%\s*(?:approve|approval)/i);
        if (ceoM) data.ceoApproval = parseInt(ceoM[1]);
      }
      if (!data.recommendToFriend) {
        const recM = combinedText.match(/(\d+)%\s*(?:would recommend|recommend)/i);
        if (recM) data.recommendToFriend = parseInt(recM[1]);
      }
      if (!data.reviewCount) {
        const rcM = combinedText.match(/([\d,]+)\s*reviews?/i);
        if (rcM) data.reviewCount = parseInt(rcM[1].replace(/,/g, ''));
      }
      if (!data.ceoName) {
        const ceoNM = combinedText.match(/CEO[,\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i) ||
                      combinedText.match(/([A-Z][a-z]+ [A-Z][a-z]+)[,\s]+CEO/i);
        if (ceoNM) data.ceoName = ceoNM[1].trim();
      }
      // Review snippet text — save as pros/cons by sentiment
      if (r.snippet.length > 30) {
        if (data.pros.length < 6 && /great|excellent|good|strong|best|love|amazing|flexible|solid|competitive|growth/i.test(r.snippet)) {
          data.pros.push(r.snippet.slice(0, 200));
        }
        if (data.cons.length < 6 && /poor|bad|toxic|difficult|slow|burnout|underpaid|micromanage|politics|turnover|layoff/i.test(r.snippet)) {
          data.cons.push(r.snippet.slice(0, 200));
        }
      }
      // Track the first Glassdoor company URL (Reviews or Overview) for direct fetch
      const isGlassdoorCompanyPage = lower.includes('glassdoor.com') &&
          (lower.includes('/reviews/') || lower.includes('-reviews-') ||
           lower.includes('/overview/') || lower.includes('-overview-') || lower.includes('/working-at-'));
      if (isGlassdoorCompanyPage && !glassdoorDirectUrl) glassdoorDirectUrl = r.link;

      // Save ALL review-site results as sources (Glassdoor, Comparably, Indeed, Blind, Levels, etc.)
      const isReviewSite = lower.includes('glassdoor.com') || lower.includes('comparably.com') ||
        lower.includes('indeed.com') || lower.includes('teamblind.com') ||
        lower.includes('levels.fyi') || lower.includes('reddit.com') ||
        lower.includes('linkedin.com') || lower.includes('salary.com') ||
        lower.includes('payscale.com') || lower.includes('builtin.com') ||
        lower.includes('ziprecruiter.com') || lower.includes('builtinnyc.com') ||
        lower.includes('builtinla.com') || lower.includes('builtinchicago.com');
      if (isReviewSite) {
        sources.push({ url: r.link, type: 'glassdoor', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
      }
    }
  }

  // Strategy 1b: Fetch the Glassdoor Reviews page and extract Apollo GraphQL state.
  // Glassdoor embeds the full company data object as window.__INITIAL_STATE__.apolloState —
  // Employer:* keys hold rating, CEO approval, recommend%, and Review:* keys hold pros/cons.
  // This beats JSON-LD (which only has aggregateRating) and HTML scraping (defeated by Cloudflare JS).
  if (glassdoorDirectUrl) {
    const gdHtml = await fetchGlassdoor(glassdoorDirectUrl);
    if (gdHtml && gdHtml.length > 1000) {
      // Primary: Apollo state (company + review objects embedded as JSON in page source)
      const apolloState = extractApolloState(gdHtml);
      if (apolloState) {
        const employerEntry = Object.entries(apolloState).find(([k]) => k.startsWith('Employer:'));
        if (employerEntry) {
          const emp = employerEntry[1] as Record<string, unknown>;
          if (emp.overallRating && !data.overallRating)
            data.overallRating = typeof emp.overallRating === 'number' ? emp.overallRating : parseFloat(String(emp.overallRating));
          if (emp.numberOfRatings && !data.reviewCount)
            data.reviewCount = typeof emp.numberOfRatings === 'number' ? emp.numberOfRatings : parseInt(String(emp.numberOfRatings));
          if (emp.recommendToFriendPercent && !data.recommendToFriend)
            data.recommendToFriend = typeof emp.recommendToFriendPercent === 'number' ? emp.recommendToFriendPercent : parseInt(String(emp.recommendToFriendPercent));
          // CEO object may be inlined or referenced
          const ceoObj = emp.ceo as Record<string, unknown> | undefined;
          if (ceoObj?.name && !data.ceoName) data.ceoName = String(ceoObj.name);
          if (ceoObj?.approvalPercent && !data.ceoApproval)
            data.ceoApproval = typeof ceoObj.approvalPercent === 'number' ? ceoObj.approvalPercent : parseInt(String(ceoObj.approvalPercent));
        }
        // Review:* entries contain actual pros/cons text
        const reviewEntries = Object.entries(apolloState)
          .filter(([k]) => k.startsWith('Review:'))
          .map(([, v]) => v as Record<string, unknown>);
        for (const review of reviewEntries.slice(0, 20)) {
          const pros = review.pros as string | undefined;
          const cons = review.cons as string | undefined;
          if (pros && pros.length > 15 && data.pros.length < 8) data.pros.push(pros.slice(0, 200));
          if (cons && cons.length > 15 && data.cons.length < 8) data.cons.push(cons.slice(0, 200));
        }
      }
      // Fallback: JSON-LD aggregateRating (present even when Cloudflare blocks JS execution)
      if (!data.overallRating || !data.reviewCount) {
        const ldMatches = gdHtml.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
        for (const m of ldMatches) {
          try {
            const json = JSON.parse(m[1]);
            const rating = json?.aggregateRating?.ratingValue;
            const count = json?.aggregateRating?.reviewCount;
            if (rating && !data.overallRating) data.overallRating = parseFloat(rating);
            if (count && !data.reviewCount) data.reviewCount = parseInt(String(count).replace(/,/g, ''));
          } catch { /* skip malformed JSON-LD */ }
        }
      }
      // Fallback: HTML selector parsing
      parseGlassdoorHtml(gdHtml, data, glassdoorDirectUrl, sources, companyName);
    }
  }

  // Comparably — server-side rendered, less aggressive bot detection
  const comparablySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const comparablyReviewsUrl = `https://www.comparably.com/companies/${comparablySlug}/reviews`;
  // Always add Comparably as a source — even if fetch fails it's a real attempted source
  sources.push({ url: comparablyReviewsUrl, type: 'glassdoor', title: `${companyName} Reviews - Comparably`, timestamp: new Date().toISOString() });
  const comparablyHtml = await fetchHtml(comparablyReviewsUrl);
  if (comparablyHtml && comparablyHtml.length > 2000) {
    const $c = cheerio.load(comparablyHtml);
    const bodyText = $c('body').text().replace(/\s+/g, ' ');
    if (!data.overallRating) {
      const scoreM = bodyText.match(/(\d+)%\s*(?:of employees|say|positive|overall|culture)/i);
      if (scoreM) data.overallRating = Math.round((parseInt(scoreM[1]) / 100) * 5 * 10) / 10;
    }
    if (!data.overallRating) {
      const rM = bodyText.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)/i);
      if (rM) data.overallRating = parseFloat(rM[1]);
    }
    if (!data.ceoApproval) {
      const ceoM = bodyText.match(/(\d+)%\s*(?:approve|approval|approve of CEO)/i);
      if (ceoM) data.ceoApproval = parseInt(ceoM[1]);
    }
    if (!data.recommendToFriend) {
      const recM = bodyText.match(/(\d+)%\s*(?:would recommend|recommend this company)/i);
      if (recM) data.recommendToFriend = parseInt(recM[1]);
    }
    $c('[class*="pros"],[class*="positive"],[class*="strength"]').each((_, el) => {
      const t = $c(el).text().trim();
      if (t.length > 15 && t.length < 300 && data.pros.length < 5) data.pros.push(t.slice(0, 200));
    });
    $c('[class*="cons"],[class*="negative"],[class*="weakness"]').each((_, el) => {
      const t = $c(el).text().trim();
      if (t.length > 15 && t.length < 300 && data.cons.length < 5) data.cons.push(t.slice(0, 200));
    });
  }

  // Comparably CEO page
  const comparablyCeoUrl = `https://www.comparably.com/companies/${comparablySlug}/ceo`;
  sources.push({ url: comparablyCeoUrl, type: 'glassdoor', title: `${companyName} CEO - Comparably`, timestamp: new Date().toISOString() });
  if (!data.ceoName || !data.ceoApproval) {
    const ceoPageHtml = await fetchHtml(comparablyCeoUrl);
    if (ceoPageHtml && ceoPageHtml.length > 1000) {
      const $cc = cheerio.load(ceoPageHtml);
      const bodyText = $cc('body').text().replace(/\s+/g, ' ');
      const ceoNameM = bodyText.match(/([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:is|,)\s*(?:the\s+)?(?:CEO|Chief Executive)/i) ||
                       bodyText.match(/CEO\s+(?:of\s+\w+\s+)?(?:is\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/i);
      if (ceoNameM && !data.ceoName) data.ceoName = ceoNameM[1].trim();
      const approvalM = bodyText.match(/(\d+)%\s*(?:of employees|approve|positive)/i);
      if (approvalM && !data.ceoApproval) data.ceoApproval = parseInt(approvalM[1]);
    }
  }

  // Google News RSS — reputation, CEO, interview signals
  const repRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${companyName}" glassdoor OR comparably reviews rating culture employees`)}&hl=en-US&gl=US&ceid=US:en`;
  sources.push({ url: repRssUrl, type: 'glassdoor', title: `${companyName} Reputation News`, timestamp: new Date().toISOString() });
  const repRss = await fetchHtml(repRssUrl);
  if (repRss && repRss.length > 500) {
    const $r = cheerio.load(repRss, { xmlMode: true });
    const allText: string[] = [];
    $r('item').each((_, el) => {
      allText.push(`${$r(el).find('title').text()} ${$r(el).find('description').text().replace(/<[^>]*>/g, '')}`);
    });
    const plain = allText.join(' ');
    if (!data.overallRating) {
      const rM = plain.match(/(\d\.\d)\s*(?:out of 5|stars?|\/5)/i);
      if (rM) data.overallRating = parseFloat(rM[1]);
    }
    if (!data.ceoApproval) {
      const ceoM = plain.match(/(\d+)%\s*(?:approve|approval)/i);
      if (ceoM) data.ceoApproval = parseInt(ceoM[1]);
    }
    if (!data.ceoName) {
      const ceoNameM = plain.match(/(?:CEO|Chief Executive)[,\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i) ||
                       plain.match(/([A-Z][a-z]+ [A-Z][a-z]+)[,\s]+CEO/i);
      if (ceoNameM) data.ceoName = ceoNameM[1].trim();
    }
  }

  const intRssQuery = `"${companyName}" interview process experience questions difficulty`;
  const intRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(intRssQuery)}&hl=en-US&gl=US&ceid=US:en`;
  sources.push({ url: intRssUrl, type: 'glassdoor', title: `${companyName} Interview Data`, timestamp: new Date().toISOString() });
  const intRss = await fetchHtml(intRssUrl);
  if (intRss && intRss.length > 500) {
    const $int = cheerio.load(intRss, { xmlMode: true });
    $int('item').each((_, el) => {
      const desc = $int(el).find('description').text().replace(/<[^>]*>/g, '').trim();
      const combined = `${$int(el).find('title').text()} ${desc}`;
      if (!data.interviewExperience) {
        const posM = combined.match(/(\d+)%\s*(?:positive|had a positive)/i);
        if (posM) { const pos = parseInt(posM[1]); data.interviewExperience = { positive: pos, neutral: 20, negative: 100 - pos - 20 }; }
      }
      if (desc.length > 40 && /interview|hiring|onsite|technical|process/i.test(combined) && (data.interviewQuotes?.length ?? 0) < 3) {
        if (!data.interviewQuotes) data.interviewQuotes = [];
        data.interviewQuotes.push(desc.slice(0, 250));
      }
    });
  }

  // Strategy 2: Indeed company reviews — structured page with JSON-LD
  const indeedSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const indeedUrl = `https://www.indeed.com/cmp/${indeedSlug}/reviews`;
  sources.push({ url: indeedUrl, type: 'glassdoor', title: `${companyName} Reviews - Indeed`, timestamp: new Date().toISOString() });
  if (!data.overallRating || data.pros.length === 0) {
    const indeedHtml = await fetchHtml(indeedUrl, { Referer: 'https://www.indeed.com/' });
    if (indeedHtml && indeedHtml.length > 3000) {
      const $i = cheerio.load(indeedHtml);

      // JSON-LD has structured rating data
      $i('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($i(el).html() || '{}');
          if (json.aggregateRating?.ratingValue && !data.overallRating) {
            data.overallRating = parseFloat(json.aggregateRating.ratingValue);
            data.reviewCount = parseInt(json.aggregateRating.reviewCount || '0');
          }
        } catch { /* skip */ }
      });

      // Selector + regex fallbacks
      if (!data.overallRating) {
        const ratingText = $i('[data-testid="rating-number"], [itemprop="ratingValue"], .css-1aq5k5r').first().text().trim();
        const r = parseFloat(ratingText);
        if (!isNaN(r) && r >= 1 && r <= 5) data.overallRating = r;
      }
      if (!data.overallRating) {
        const bodyText = $i('body').text();
        const m = bodyText.match(/(\d\.\d)\s*(?:out of 5|stars?)/i);
        if (m) data.overallRating = parseFloat(m[1]);
        if (!data.reviewCount) {
          const rcM = bodyText.match(/([\d,]+)\s*reviews?/i);
          if (rcM) data.reviewCount = parseInt(rcM[1].replace(/,/g, ''));
        }
      }

      $i('[data-testid="pros-list"] li, [class*="pros"] li').each((_, el) => {
        data.pros.push($i(el).text().trim().slice(0, 200));
      });
      $i('[data-testid="cons-list"] li, [class*="cons"] li').each((_, el) => {
        data.cons.push($i(el).text().trim().slice(0, 200));
      });
    }
  }

  // Blind — anonymous employee posts, often more candid than Glassdoor
  // Run in parallel with everything else already done above
  const { rating: blindRating, posts: blindPosts, sources: blindSources } = await scrapeBlind(companyName);
  if (blindRating !== null) data.blindRating = blindRating;
  if (blindPosts.length > 0) {
    data.blindPosts = blindPosts;
    // Merge into pros/cons based on sentiment
    for (const post of blindPosts) {
      if (data.pros.length < 8 && /great|good|love|excellent|strong|best|flexible|remote|growth|pay|compensation/i.test(post)) {
        data.pros.push(`[Blind] ${post.slice(0, 180)}`);
      } else if (data.cons.length < 8 && /bad|toxic|poor|slow|burnout|underpaid|micromanage|politics|layoff|terrible|awful/i.test(post)) {
        data.cons.push(`[Blind] ${post.slice(0, 180)}`);
      }
    }
  }
  sources.push(...blindSources);

  return { data, sources };
}

// ── LEVELS.FYI / SALARY INTELLIGENCE ────────────────────────────────────────
// Levels.fyi is JS-rendered so we search the web for salary data instead
function extractSalaries(text: string): number[] {
  const matches = [...text.matchAll(/\$\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/g)];
  return matches
    .map(m => {
      const n = parseFloat(m[1].replace(/,/g, ''));
      return m[2] ? n * 1000 : n;
    })
    .filter(n => n >= 40000 && n <= 700000);
}

export async function scrapeLevels(
  companyName: string,
  role: string,
  location: string
): Promise<{ data: LevelsData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: LevelsData = { targetRoleSalaries: [], comparableSalaries: [] };

  // Primary: Serper.dev / SerpAPI web search for salary data — snippets from salary sites
  // contain actual dollar figures unlike news articles
  const serpSalaryQueries = [
    `"${companyName}" "${role}" salary compensation base pay`,
    `"${role}" average salary ${location} 2024 2025`,
    `"${role}" salary range levels compensation`,
  ];
  for (const q of serpSalaryQueries) {
    const results = await searchWeb(q, 10);
    const allSnippets = results.map(r => `${r.title} ${r.snippet}`).join(' ');
    const salaries = extractSalaries(allSnippets);
    if (salaries.length > 0) {
      const sorted = salaries.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (data.targetRoleSalaries.length === 0 && q.includes(companyName)) {
        data.targetRoleSalaries.push({ company: companyName, role, base: median, totalComp: Math.round(median * 1.3), location });
      } else if (data.comparableSalaries.length < 8) {
        const source = results[0]?.link.match(/(?:salary\.com|glassdoor\.com|levels\.fyi|ziprecruiter\.com|indeed\.com|builtin\.com)/)?.[0] || 'Market data';
        data.comparableSalaries.push({ company: source, base: median, totalComp: Math.round(median * 1.3) });
      }
      for (const r of results.slice(0, 3)) {
        sources.push({ url: r.link, type: 'levels', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    }
  }

  // Google News RSS — company-specific salary articles
  const companyQuery = `"${companyName}" "${role}" salary compensation`;
  const rss1 = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(companyQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (rss1 && rss1.length > 500) {
    const $c = cheerio.load(rss1, { xmlMode: true });
    const allText: string[] = [];
    $c('item').each((_, el) => {
      const title = $c(el).find('title').text();
      const desc = $c(el).find('description').text().replace(/<[^>]*>/g, '');
      allText.push(`${title} ${desc}`);
    });
    const salaries = extractSalaries(allText.join(' '));
    if (salaries.length > 0 && data.targetRoleSalaries.length === 0) {
      const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
      data.targetRoleSalaries.push({ company: companyName, role, base: avg, totalComp: Math.round(avg * 1.3), location });
    }
    sources.push({ url: `https://news.google.com/rss/search?q=${encodeURIComponent(companyQuery)}`, type: 'levels', title: `${companyName} ${role} Salary`, timestamp: new Date().toISOString() });
  }

  // Market comps — role + location salary news
  const newsQuery = `"${role}" salary compensation ${location} 2024 2025`;
  const rss2 = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(newsQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (rss2 && rss2.length > 500) {
    const $n = cheerio.load(rss2, { xmlMode: true });
    $n('item').each((_, el) => {
      const title = $n(el).find('title').text();
      const desc = $n(el).find('description').text().replace(/<[^>]*>/g, '');
      const link = $n(el).find('link').text().trim() || $n(el).find('guid').text().trim();
      const salaries = extractSalaries(`${title} ${desc}`);
      if (salaries.length > 0 && data.comparableSalaries.length < 8) {
        const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
        const source = $n(el).find('source').text().trim() || 'News';
        data.comparableSalaries.push({ company: source, base: avg, totalComp: Math.round(avg * 1.3) });
        if (link) sources.push({ url: link, type: 'levels', title: title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    });
  }

  // Broader market comps — generic role salary data
  const marketQuery = `"${role}" average salary 2024 2025 annual compensation`;
  const rss3 = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(marketQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (rss3 && rss3.length > 500) {
    const $m = cheerio.load(rss3, { xmlMode: true });
    $m('item').each((_, el) => {
      const title = $m(el).find('title').text();
      const desc = $m(el).find('description').text().replace(/<[^>]*>/g, '');
      const link = $m(el).find('link').text().trim() || $m(el).find('guid').text().trim();
      const salaries = extractSalaries(`${title} ${desc}`);
      if (salaries.length > 0 && data.comparableSalaries.length < 8) {
        const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
        const source = $m(el).find('source').text().trim() || 'Market data';
        data.comparableSalaries.push({ company: source, base: avg, totalComp: Math.round(avg * 1.3) });
        if (link) sources.push({ url: link, type: 'levels', title: title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    });
  }

  // Direct salary site fetches — ZipRecruiter and Indeed have static-ish salary pages
  const roleSlug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // ZipRecruiter
  const zipUrl = `https://www.ziprecruiter.com/Salaries/${roleSlug}-Salary`;
  const zipHtml = await fetchHtml(zipUrl);
  if (zipHtml && zipHtml.length > 2000) {
    const $z = cheerio.load(zipHtml);
    const bodyText = $z('body').text().replace(/\s+/g, ' ');
    const avgM = bodyText.match(/average[^$]{0,30}\$\s*([\d,]+)/i) || bodyText.match(/\$\s*([\d]{2,3},\d{3})\s*(?:per year|annually|average)/i);
    if (avgM) {
      const avg = parseInt(avgM[1].replace(/,/g, ''));
      if (avg >= 25000 && avg <= 600000) {
        data.targetRoleSalaries.push({ company: 'ZipRecruiter', role, base: avg, totalComp: Math.round(avg * 1.2), location });
        sources.push({ url: zipUrl, type: 'levels', title: `${role} Salary - ZipRecruiter`, timestamp: new Date().toISOString() });
      }
    }
  }

  // Indeed Salaries
  const indeedUrl = `https://www.indeed.com/career/${roleSlug}/salaries`;
  const indeedHtml = await fetchHtml(indeedUrl, { 'Accept-Language': 'en-US,en;q=0.9' });
  if (indeedHtml && indeedHtml.length > 2000 && !indeedHtml.includes('sign in') && !indeedHtml.includes('Sign in')) {
    const $i = cheerio.load(indeedHtml);
    const bodyText = $i('body').text().replace(/\s+/g, ' ');
    const avgM = bodyText.match(/average(?:\s+base)?\s+salary[^$]{0,30}\$\s*([\d,]+)/i) || bodyText.match(/\$\s*([\d]{2,3},\d{3})\s*(?:per year|\/yr|annually)/i);
    if (avgM) {
      const avg = parseInt(avgM[1].replace(/,/g, ''));
      if (avg >= 25000 && avg <= 600000) {
        data.comparableSalaries.push({ company: 'Indeed', base: avg, totalComp: Math.round(avg * 1.2) });
        sources.push({ url: indeedUrl, type: 'levels', title: `${role} Salaries - Indeed`, timestamp: new Date().toISOString() });
      }
    }
  }

  return { data, sources };
}

// ── BLS ──────────────────────────────────────────────────────────────────────

/**
 * Extract specific percentile salary figures from text.
 * Handles patterns like "25th percentile: $85,000", "$95k at the 75th percentile",
 * "10th percentile $62,000", "median annual wage $115,000".
 */
function extractPercentileData(text: string): {
  p10?: number; p25?: number; p50?: number; p75?: number; p90?: number;
} {
  const result: { p10?: number; p25?: number; p50?: number; p75?: number; p90?: number } = {};

  const patterns: Array<[keyof typeof result, RegExp]> = [
    ['p10', /10th?\s*percentile[^$\d]{0,20}\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/i],
    ['p25', /25th?\s*percentile[^$\d]{0,20}\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/i],
    ['p50', /(?:50th?\s*percentile|median\s*(?:annual\s*)?(?:wage|salary))[^$\d]{0,20}\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/i],
    ['p75', /75th?\s*percentile[^$\d]{0,20}\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/i],
    ['p90', /90th?\s*percentile[^$\d]{0,20}\$?\s*(\d{2,3}(?:,\d{3})?(?:\.\d+)?)\s*(k|K)?/i],
  ];

  for (const [key, pattern] of patterns) {
    const m = text.match(pattern);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      const val = m[2] ? n * 1000 : n;
      if (val >= 25_000 && val <= 800_000) result[key] = Math.round(val);
    }
  }
  return result;
}

/**
 * Role-category-aware percentile multipliers.
 * Tech/Finance have wide distributions; Healthcare/Education are narrow.
 */
function getPercentileFactors(role: string): { p10: number; p25: number; p75: number; p90: number } {
  const r = role.toLowerCase();
  if (/\b(?:engineer|developer|software|data\s*scientist|architect|devops|sre|ml|machine\s*learning|ai\s*engineer|full.?stack|backend|frontend|quantitative)\b/.test(r)) {
    return { p10: 0.52, p25: 0.70, p75: 1.42, p90: 1.90 }; // tech: wide, senior 3–4× entry
  }
  if (/\b(?:finance|investment|banking|trader|portfolio|hedge\s*fund|private\s*equity|analyst)\b/.test(r)) {
    return { p10: 0.48, p25: 0.65, p75: 1.50, p90: 2.10 }; // finance: very wide, bonus-heavy
  }
  if (/\b(?:nurse|physician|doctor|surgeon|pharmacist|dentist|therapist|clinical)\b/.test(r)) {
    return { p10: 0.68, p25: 0.83, p75: 1.22, p90: 1.45 }; // healthcare: union/license constrained
  }
  if (/\b(?:teacher|professor|principal|instructor|educator|school)\b/.test(r)) {
    return { p10: 0.73, p25: 0.87, p75: 1.17, p90: 1.36 }; // education: very tight bands
  }
  if (/\b(?:sales|account\s*executive|business\s*development|sales\s*rep)\b/.test(r)) {
    return { p10: 0.50, p25: 0.68, p75: 1.45, p90: 1.95 }; // sales: wide due to OTE variable
  }
  return { p10: 0.58, p25: 0.76, p75: 1.30, p90: 1.65 }; // general default
}

export async function scrapeBLS(
  role: string,
  location?: string,
  companyName?: string,
): Promise<{ data: BLSData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: BLSData = {
    occupationTitle: role,
    medianSalary: null,
    p10: null,
    p25: null,
    p75: null,
    p90: null,
    yearOverYearChange: 'N/A',
    locationData: '',
  };

  // ── All searches run in parallel ─────────────────────────────────────────────
  const locationQ = location && location !== 'Remote' ? location : 'United States';

  const [
    salarySet1,
    salarySet2,
    salarySet3,
    salarySet4,
    percentileResults,
    blsOesResults,
    locResults,
  ] = await Promise.all([
    searchWeb(`"${role}" average salary 2024 2025 site:salary.com OR site:payscale.com OR site:glassdoor.com`, 6),
    searchWeb(`"${role}" median annual wage site:bls.gov`, 5),
    searchWeb(`"${role}" average salary ${locationQ} 2024 2025`, 5),
    searchWeb(`"${role}" salary comparably.com OR ziprecruiter.com OR builtin.com`, 5),
    // Specifically look for percentile breakdown data
    searchWeb(`"${role}" "25th percentile" "75th percentile" salary 2024 2025`, 6),
    // BLS OES pages have full p10/p25/p75/p90 tables
    searchWeb(`"${role}" site:bls.gov/oes annual percentile wage estimate`, 4),
    // Location-specific
    location && location !== 'Remote'
      ? searchWeb(`"${role}" salary "${location}" "25th percentile" OR "75th percentile" OR average 2024 2025`, 5)
      : Promise.resolve([]),
  ]);

  // ── Step 1: Extract median from general salary snippets ──────────────────────
  const allSalaryResults = [...salarySet1, ...salarySet2, ...salarySet3, ...salarySet4];
  const allSalaryText = allSalaryResults.map(r => `${r.title} ${r.snippet}`).join(' ');
  for (const r of allSalaryResults) {
    const snippet = `${r.title} ${r.snippet}`;
    if (/\$[\d,]+|\d{2,3},\d{3}|per.?year|annual.?salary|average.?salary|median.?salary|median.?wage/i.test(snippet)) {
      sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
    }
  }
  const allNums = extractSalaries(allSalaryText);
  if (allNums.length > 0) {
    const sorted = allNums.sort((a, b) => a - b);
    data.medianSalary = sorted[Math.floor(sorted.length / 2)];
  }

  // ── Step 2: Extract real percentile figures from percentile-specific snippets ─
  const percentileSnippetText = percentileResults.map(r => `${r.title} ${r.snippet}`).join(' ');
  const pFromSnippets = extractPercentileData(percentileSnippetText);
  if (pFromSnippets.p25 && pFromSnippets.p75) {
    if (!data.p25) data.p25 = pFromSnippets.p25;
    if (!data.p75) data.p75 = pFromSnippets.p75;
    if (!data.medianSalary && pFromSnippets.p50) data.medianSalary = pFromSnippets.p50;
    if (!data.p10 && pFromSnippets.p10) data.p10 = pFromSnippets.p10;
    if (!data.p90 && pFromSnippets.p90) data.p90 = pFromSnippets.p90;
    for (const r of percentileResults.slice(0, 2)) {
      if (/percentile|\$[\d,]+/i.test(`${r.title} ${r.snippet}`)) {
        sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    }
  }

  // ── Step 3: BLS OES page — fetch actual percentile table ─────────────────────
  // Only do this if we still lack p25/p75 — costs an extra fetch but gives authoritative data
  if ((!data.p25 || !data.p75) && blsOesResults.length > 0) {
    const oesPage = blsOesResults.find(r => /bls\.gov\/oes\//.test(r.link));
    if (oesPage) {
      const oesHtml = await fetchHtml(oesPage.link);
      if (oesHtml) {
        const $oes = cheerio.load(oesHtml);
        // OES pages: percentile table has column headers 10%, 25%, 50%, 75%, 90%
        $oes('table').each((_, table) => {
          if (data.p25 && data.p75) return; // already found
          const headers = $oes(table).find('tr').first().find('th, td')
            .map((_, el) => $oes(el).text().replace(/\s+/g, ' ').trim()).get();
          const idx: Record<string, number> = {};
          headers.forEach((h, i) => {
            if (/\b10\b/.test(h)) idx.p10 = i;
            if (/\b25\b/.test(h)) idx.p25 = i;
            if (/\b50\b|median/i.test(h)) idx.p50 = i;
            if (/\b75\b/.test(h)) idx.p75 = i;
            if (/\b90\b/.test(h)) idx.p90 = i;
          });
          if (idx.p50 === undefined && idx.p25 === undefined) return;
          $oes(table).find('tr').each((_, row) => {
            const rowText = $oes(row).text().toLowerCase();
            if (!/annual/i.test(rowText)) return;
            const cells = $oes(row).find('td');
            const getCell = (i?: number): number | undefined => {
              if (i === undefined) return undefined;
              const raw = $oes(cells.eq(i)).text().replace(/[$,\s]/g, '');
              const n = parseInt(raw);
              return n >= 25_000 && n <= 800_000 ? n : undefined;
            };
            if (!data.p10) data.p10 = getCell(idx.p10) ?? null;
            if (!data.p25) data.p25 = getCell(idx.p25) ?? null;
            if (!data.medianSalary) data.medianSalary = getCell(idx.p50) ?? null;
            if (!data.p75) data.p75 = getCell(idx.p75) ?? null;
            if (!data.p90) data.p90 = getCell(idx.p90) ?? null;
          });
        });
        if (data.p25 || data.medianSalary) {
          // Grab occupation title from the page <h1>
          const title = $oes('h1').first().text().trim();
          if (title) data.occupationTitle = title;
          sources.push({ url: oesPage.link, type: 'bls', title: `BLS OES — ${data.occupationTitle}`, timestamp: new Date().toISOString() });
        }
      }
    }
  }

  // ── Step 4: BLS Occupational Outlook Handbook (fallback for median) ───────────
  if (!data.medianSalary) {
    const oohQuery = role.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
    const oohUrl = `https://www.bls.gov/ooh/occupation-finder.htm?pay=all&education=all&training=all&newjobs=all&growth=all&submit=GO&searchbar=${oohQuery}`;
    const oohHtml = await fetchHtml(oohUrl);
    if (oohHtml) {
      const $o = cheerio.load(oohHtml);
      const roleWords = role.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      $o('table tbody tr').each((_, row) => {
        if (data.medianSalary) return;
        const rowText = $o(row).text();
        if (!roleWords.some(w => rowText.toLowerCase().includes(w))) return;
        const cells = $o(row).find('td');
        const payCell = [...Array(cells.length).keys()]
          .map(i => $o(cells.eq(i)).text().trim())
          .find(t => /^\$[\d,]+/.test(t));
        if (payCell) {
          const val = parseInt(payCell.replace(/[^0-9]/g, ''));
          if (val >= 25_000 && val <= 600_000) {
            data.medianSalary = val;
            data.occupationTitle = $o(cells.eq(0)).text().trim() || role;
            sources.push({ url: oohUrl, type: 'bls', title: 'BLS Occupational Outlook Handbook', timestamp: new Date().toISOString() });
          }
        }
      });
    }
  }

  // ── Step 5: ZipRecruiter fallback (last resort for median) ───────────────────
  if (!data.medianSalary) {
    const zipUrl = `https://www.ziprecruiter.com/Salaries/${encodeURIComponent(role.replace(/\s+/g, '-'))}-Salary`;
    const zipHtml = await fetchHtml(zipUrl);
    if (zipHtml && zipHtml.length > 2000) {
      const $z = cheerio.load(zipHtml);
      const nums = extractSalaries($z('body').text().replace(/\s+/g, ' '));
      if (nums.length > 0) {
        data.medianSalary = nums.sort((a, b) => a - b)[Math.floor(nums.length / 2)];
        sources.push({ url: zipUrl, type: 'bls', title: `${role} Salary — ZipRecruiter`, timestamp: new Date().toISOString() });
      }
    }
  }

  // ── Step 5b: Simplified role fallback — strip seniority for niche titles ─────
  // "Senior Regenerative Grazing Consultant" → "Regenerative Grazing Consultant"
  // "Lead Web3 Community Manager" → "Web3 Community Manager"
  // If still no data, try the core function words without seniority prefix.
  if (!data.medianSalary) {
    const simplified = role
      .replace(/^(?:senior|lead|principal|staff|head\s+of|director\s+of|vp\s+of|chief|junior|jr\.?|associate|sr\.?|founding|founding\s+)\s+/i, '')
      .replace(/\s+(?:i|ii|iii|iv|1|2|3)$/i, '')
      .trim();

    if (simplified !== role && simplified.split(' ').length >= 2) {
      const [simpSet1, simpSet2] = await Promise.all([
        searchWeb(`"${simplified}" average salary 2024 2025 site:salary.com OR site:payscale.com OR site:glassdoor.com`, 5),
        searchWeb(`"${simplified}" median annual wage site:bls.gov`, 4),
      ]);
      const simpText = [...simpSet1, ...simpSet2].map(r => `${r.title} ${r.snippet}`).join(' ');
      const simpNums = extractSalaries(simpText);
      if (simpNums.length > 0) {
        data.medianSalary = simpNums.sort((a, b) => a - b)[Math.floor(simpNums.length / 2)];
        data.occupationTitle = `${simplified} (from: ${role})`;
        for (const r of [...simpSet1, ...simpSet2].slice(0, 2)) {
          if (/\$[\d,]+|\d{2,3},\d{3}/i.test(`${r.title} ${r.snippet}`)) {
            sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
          }
        }
      }
    }
  }

  // ── Step 6: Location-specific data ───────────────────────────────────────────
  if (location && location !== 'Remote' && locResults.length > 0) {
    const locText = locResults.map(r => `${r.title} ${r.snippet}`).join(' ');
    // Try to get real percentiles for the location first
    const locPercentiles = extractPercentileData(locText);
    if (locPercentiles.p25 && locPercentiles.p75) {
      // We have location-specific percentile data — use it directly
      data.p25 = locPercentiles.p25;
      data.p75 = locPercentiles.p75;
      if (locPercentiles.p50) data.medianSalary = locPercentiles.p50;
      if (locPercentiles.p10) data.p10 = locPercentiles.p10;
      if (locPercentiles.p90) data.p90 = locPercentiles.p90;
      data.locationData = `${location}: $${(locPercentiles.p50 ?? data.medianSalary ?? 0).toLocaleString()} median`;
    } else {
      // Fall back to location median and use it to ratio-shift all bands
      const locNums = extractSalaries(locText);
      if (locNums.length > 0) {
        const locMedian = locNums.sort((a, b) => a - b)[Math.floor(locNums.length / 2)];
        data.locationData = `${location} average: $${locMedian.toLocaleString()}`;
        // Shift all percentile bands proportionally if we have a national median to compare against
        if (data.medianSalary && locMedian !== data.medianSalary) {
          const ratio = Math.min(Math.max(locMedian / data.medianSalary, 0.55), 2.0);
          data.medianSalary = locMedian;
          if (data.p10) data.p10 = Math.round(data.p10 * ratio);
          if (data.p25) data.p25 = Math.round(data.p25 * ratio);
          if (data.p75) data.p75 = Math.round(data.p75 * ratio);
          if (data.p90) data.p90 = Math.round(data.p90 * ratio);
        } else if (!data.medianSalary) {
          data.medianSalary = locMedian;
        }
      }
    }
    if (locResults[0]) {
      sources.push({ url: locResults[0].link, type: 'bls', title: locResults[0].title.slice(0, 80), timestamp: new Date().toISOString() });
    }
  }

  // ── Step 7: Derive remaining percentiles from median ─────────────────────────
  // Uses role-category-aware multipliers — tech is wider, healthcare is narrower, etc.
  if (data.medianSalary) {
    const f = getPercentileFactors(role);
    if (!data.p10)  data.p10  = Math.round(data.medianSalary * f.p10);
    if (!data.p25)  data.p25  = Math.round(data.medianSalary * f.p25);
    if (!data.p75)  data.p75  = Math.round(data.medianSalary * f.p75);
    if (!data.p90)  data.p90  = Math.round(data.medianSalary * f.p90);
  }

  // ── Step 8: H-1B DOL salary disclosure ───────────────────────────────────────
  const { hibData, sources: hibSources } = companyName
    ? await scrapeHIBSalaries(companyName, role)
    : { hibData: undefined, sources: [] };
  if (hibData) {
    data.hibData = hibData;
    if (!data.medianSalary) data.medianSalary = hibData.median;
    sources.push(...hibSources);
  }

  return { data, sources };
}


// ── H-1B SALARY DISCLOSURE (DOL public LCA data via h1bdata.info) ─────────
// The Department of Labor publishes every H-1B Labor Condition Application —
// real certified wages for real positions at real companies. No estimates.
async function scrapeHIBSalaries(
  companyName: string,
  role: string,
): Promise<{ hibData: BLSData['hibData']; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const salaries: number[] = [];

  // Serper: Google has cached h1bdata.info tables — fast path
  const serperRes = await searchWeb(`site:h1bdata.info "${companyName}"`, 5);
  for (const r of serperRes) {
    if (!r.link.includes('h1bdata.info')) continue;
    const nums = extractSalaries(`${r.title} ${r.snippet}`);
    salaries.push(...nums.filter(n => n > 30000 && n < 600000));
    sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
  }

  // Direct fetch — h1bdata.info returns an HTML table with certified wages
  const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '+');
  const roleSlug = role.toLowerCase().replace(/[^a-z0-9]+/g, '+');
  const url = `https://h1bdata.info/index.php?em=${companySlug}&job=${roleSlug}&city=&year=All+Years`;
  const html = await fetchHtml(url);
  if (html && html.length > 500) {
    const $ = cheerio.load(html);
    $('table tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      const salaryText = cells.eq(2).text().trim().replace(/[$,]/g, '');
      const num = parseInt(salaryText);
      if (!isNaN(num) && num > 30000 && num < 600000) salaries.push(num);
    });
    if (salaries.length > 0) {
      sources.push({ url, type: 'bls', title: `H-1B DOL Data: ${companyName} — ${role}`, timestamp: new Date().toISOString() });
    }
  }

  if (salaries.length === 0) return { hibData: undefined, sources };

  salaries.sort((a, b) => a - b);
  const median = salaries[Math.floor(salaries.length / 2)];
  return {
    hibData: { median, sampleSize: salaries.length, low: salaries[0], high: salaries[salaries.length - 1] },
    sources,
  };
}

// ── BLIND (teamblind.com — anonymous employee posts, more candid than GD) ──
async function scrapeBlind(
  companyName: string,
): Promise<{ rating: number | null; posts: string[]; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  let rating: number | null = null;
  const posts: string[] = [];

  // Serper: Google caches Blind company pages
  const serperRes = await searchWeb(`"${companyName}" site:teamblind.com reviews`, 8);
  for (const r of serperRes) {
    if (!r.link.includes('teamblind.com')) continue;
    const text = `${r.title} ${r.snippet}`;
    if (!rating) {
      const rM = text.match(/(\d\.\d)\s*(?:out of 5|stars?|\/5)/i);
      if (rM) rating = parseFloat(rM[1]);
    }
    if (r.snippet.length > 30) posts.push(r.snippet.slice(0, 250));
    sources.push({ url: r.link, type: 'glassdoor', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }

  // Direct fetch attempt (Blind has less aggressive bot detection than GD)
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const url = `https://www.teamblind.com/company/${slug}/`;
  const html = await fetchHtml(url, { Referer: 'https://www.google.com/' });
  if (html && html.length > 2000) {
    const $b = cheerio.load(html);
    const bodyText = $b('body').text();
    if (!rating) {
      const rM = bodyText.match(/(\d\.\d)\s*(?:out of 5|\/5|stars?)/i);
      if (rM) rating = parseFloat(rM[1]);
    }
    $b('[class*="review"], [class*="post"], [class*="content"], [class*="comment"]').each((_, el) => {
      const t = $b(el).text().trim();
      if (t.length > 30 && t.length < 500 && posts.length < 12) posts.push(t.slice(0, 250));
    });
    if (!sources.some(s => s.url === url)) {
      sources.push({ url, type: 'glassdoor', title: `${companyName} — Blind Reviews`, timestamp: new Date().toISOString() });
    }
  }

  return { rating, posts: posts.slice(0, 10), sources };
}

// ── SEC EDGAR ────────────────────────────────────────────────────────────────
export async function scrapeSEC(
  companyName: string,
  companyContext?: string,
): Promise<{ data: SECData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: SECData = {
    filings: [],
    layoffSignals: [],
    executiveDepartures: [],
    fundingSignals: [],
    financialSignals: [],
  };

  // Try the exact name first; if no results, fall back to name variants
  const buildSecSearchUrl = (name: string, forms: string) =>
    `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(name)}%22&dateRange=custom&startdt=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}&forms=${forms}`;

  let searchUrl = buildSecSearchUrl(companyName, '8-K');
  let html = await fetchHtml(searchUrl, { Accept: 'application/json', Referer: 'https://efts.sec.gov/' });

  // If no results with exact name, try name variants (handles "StoneX" → "StoneX Group Inc.")
  if (!html || html.length < 50) {
    for (const variant of edgarNameVariants(companyName)) {
      if (variant === companyName) continue;
      searchUrl = buildSecSearchUrl(variant, '8-K');
      html = await fetchHtml(searchUrl, { Accept: 'application/json', Referer: 'https://efts.sec.gov/' });
      if (html && html.length > 50) break;
    }
  }

  // Track real 8-K filings (with accession numbers) for content fetching
  const eightKsToFetch: Array<{ entityId: string; accNo: string; date: string; filingUrl: string }> = [];

  if (html) {
    try {
      const json = JSON.parse(html);
      const hits = json?.hits?.hits || [];
      for (const hit of hits.slice(0, 25)) {
        const src = hit._source;
        const description = src?.display_names?.[0] || src?.entity_name || '';
        const filingDate = src?.period_of_report || src?.file_date || '';
        const formType = src?.form_type || '8-K';
        const accNo = src?.accession_no?.replace(/-/g, '') || '';
        const entityId = src?.entity_id || '';
        const filingUrl = accNo
          ? `https://www.sec.gov/Archives/edgar/data/${entityId}/${accNo}/${accNo}-index.htm`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=8-K`;

        const filingTitle = src?.file_date
          ? `${formType} filing - ${src?.display_names?.[0] || companyName}`
          : `SEC ${formType}`;

        const descLower = description.toLowerCase();
        if (descLower.includes('layoff') || descLower.includes('reduction in force') || descLower.includes('workforce')) {
          data.layoffSignals.push(`${filingDate}: ${description}`);
        }
        if (descLower.includes('departure') || descLower.includes('resignation') || descLower.includes('ceo') || descLower.includes('chief')) {
          data.executiveDepartures.push(`${filingDate}: ${description}`);
        }

        data.filings.push({
          date: filingDate,
          type: formType,
          description: description || filingTitle,
          url: filingUrl,
        });

        sources.push({
          url: filingUrl,
          type: 'sec',
          title: filingTitle,
          timestamp: filingDate || new Date().toISOString(),
        });

        // Queue real 8-K filings for content fetching (limit to 2 most recent)
        if (accNo && entityId && eightKsToFetch.length < 2) {
          eightKsToFetch.push({ entityId, accNo, date: filingDate, filingUrl });
        }
      }
    } catch { /* JSON parse error */ }
  }

  // Fetch actual 8-K document text for the 2 most recent filings with accession numbers.
  // The EDGAR index page lists all documents in the filing; we grab the primary .htm doc.
  if (eightKsToFetch.length > 0) {
    await Promise.all(eightKsToFetch.map(async ({ entityId, accNo, date, filingUrl }) => {
      try {
        const indexHtml = await fetchHtml(filingUrl);
        if (!indexHtml) return;

        // Find the primary document — first .htm that isn't the index itself
        const docLinkMatch = indexHtml.match(
          /href="(\/Archives\/edgar\/data\/[^"]+\.htm)"/gi,
        );
        if (!docLinkMatch) return;

        let primaryDocUrl = '';
        for (const m of docLinkMatch) {
          const href = m.replace(/^href="/i, '').replace(/"$/, '');
          if (!href.endsWith('-index.htm') && !href.includes('R1.htm')) {
            primaryDocUrl = `https://www.sec.gov${href}`;
            break;
          }
        }
        if (!primaryDocUrl) return;

        const docHtml = await fetchHtml(primaryDocUrl);
        if (!docHtml) return;

        // Strip HTML tags cleanly
        const docText = docHtml
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Executive departure — named officer + departure verb in same sentence
        const deptMatch = docText.match(
          /([A-Z][^.]{10,250}(?:resign|departure|step(?:ping)? down|terminat)[^.]{0,200}\.)/i,
        );
        if (deptMatch && !data.executiveDepartures.some(s => s.includes(accNo))) {
          data.executiveDepartures.push(
            `SEC 8-K (${date}): ${deptMatch[1].slice(0, 350)} [URL:${filingUrl}] [SOURCE:SEC EDGAR]`,
          );
        }

        // Workforce / restructuring language
        const rfMatch = docText.match(
          /([^.]{0,80}(?:reduction in force|workforce reduction|position(?:s)? eliminated|layoff|restructuring program|severance)[^.]{0,250}\.)/i,
        );
        if (rfMatch && !data.layoffSignals.some(s => s.includes(accNo))) {
          data.layoffSignals.push(
            `SEC 8-K (${date}): ${rfMatch[1].slice(0, 350)} [URL:${filingUrl}] [SOURCE:SEC EDGAR]`,
          );
        }
      } catch { /* skip if fetch or parse fails */ }
    }));
  }

  // Annual/Quarterly filings (10-K, 10-Q) — key for public companies
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  let annualUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K,10-Q&dateRange=custom&startdt=${oneYearAgo}&enddt=${today}`;
  let annualHtml = await fetchHtml(annualUrl, { Accept: 'application/json', Referer: 'https://efts.sec.gov/' });
  if (!annualHtml || annualHtml.length < 50) {
    for (const variant of edgarNameVariants(companyName)) {
      if (variant === companyName) continue;
      annualUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(variant)}%22&forms=10-K,10-Q&dateRange=custom&startdt=${oneYearAgo}&enddt=${today}`;
      annualHtml = await fetchHtml(annualUrl, { Accept: 'application/json', Referer: 'https://efts.sec.gov/' });
      if (annualHtml && annualHtml.length > 50) break;
    }
  }
  if (annualHtml) {
    try {
      const annualJson = JSON.parse(annualHtml);
      const annualHits = annualJson?.hits?.hits || [];
      for (const hit of annualHits.slice(0, 4)) {
        const src = hit._source;
        const formType = src?.form_type || '10-K';
        const filingDate = src?.file_date || src?.period_of_report || '';
        const accNo = src?.accession_no?.replace(/-/g, '') || '';
        const filingUrl = accNo
          ? `https://www.sec.gov/Archives/edgar/data/${src?.entity_id}/${accNo}/${accNo}-index.htm`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(companyName)}&type=${formType}`;
        data.filings.push({ date: filingDate, type: formType, description: `${formType} — ${companyName} (${filingDate})`, url: filingUrl });
        sources.push({ url: filingUrl, type: 'sec', title: `${companyName} ${formType} — ${filingDate}`, timestamp: filingDate || new Date().toISOString() });
        // If we found annual filings, flag company as public
        if (!data.financialSignals.includes('Public company — SEC annual filings available')) {
          data.financialSignals.push('Public company — SEC annual filings available');
        }
      }
    } catch { /* not a public company or no filings */ }
  }

  // All Google News + Serper queries use disambiguated company query
  const secCtx = companyContext ? ` ${companyContext}` : '';
  const secCompanyQ = `"${companyName}"${secCtx}`;

  // Financial signals via Google News RSS
  const finQuery = `${secCompanyQ} revenue earnings profit financial results 2024 2025`;
  const finRss = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(finQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (finRss && finRss.length > 500) {
    const $fin = cheerio.load(finRss, { xmlMode: true });
    $fin('item').each((_, el) => {
      const combined = `${$fin(el).find('title').text()} ${$fin(el).find('description').text().replace(/<[^>]*>/g, '')}`;
      const revM = combined.match(/revenue[^$\n]*\$\s*([\d.]+)\s*(billion|million|B|M)\b/gi);
      if (revM) data.financialSignals.push(...revM.slice(0, 2).map(m => m.trim().slice(0, 120)));
      const profitM = combined.match(/(?:profit|loss|net income)[^$\n]*\$\s*([\d.]+)\s*(?:billion|million)/gi);
      if (profitM) data.financialSignals.push(...profitM.slice(0, 1).map(m => m.trim().slice(0, 120)));
    });
    sources.push({ url: `https://news.google.com/rss/search?q=${encodeURIComponent(finQuery)}`, type: 'sec', title: `${companyName} Financial Results`, timestamp: new Date().toISOString() });
  }

  // Funding and investment signals via Google News RSS
  const fundQuery = `${secCompanyQ} funding raised investment series valuation`;
  const fundRss = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(fundQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (fundRss && fundRss.length > 500) {
    const $fund = cheerio.load(fundRss, { xmlMode: true });
    $fund('item').each((_, el) => {
      const combined = `${$fund(el).find('title').text()} ${$fund(el).find('description').text().replace(/<[^>]*>/g, '')}`;
      const fundM = combined.match(/(?:raised|funding|series|invested)[^$\n]*\$\s*([\d.]+)\s*(?:billion|million|B|M)[^\n]*/gi);
      if (fundM) data.fundingSignals.push(...fundM.slice(0, 2).map(m => m.trim().slice(0, 150)));
      const headM = combined.match(/(\d[\d,]+)\s+employees/gi);
      if (headM) data.financialSignals.push(...headM.slice(0, 1));
    });
    sources.push({ url: `https://news.google.com/rss/search?q=${encodeURIComponent(fundQuery)}`, type: 'sec', title: `${companyName} Funding`, timestamp: new Date().toISOString() });
  }

  // Hiring velocity signal — news about open roles is a health/growth indicator
  const hiringQuery = `"${companyName}" hiring "open roles" OR "job openings" OR headcount OR "growing team"`;
  const hiringRss = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(hiringQuery)}&hl=en-US&gl=US&ceid=US:en`);
  if (hiringRss && hiringRss.length > 500) {
    const $h = cheerio.load(hiringRss, { xmlMode: true });
    $h('item').each((_, el) => {
      const combined = `${$h(el).find('title').text()} ${$h(el).find('description').text().replace(/<[^>]*>/g, '')}`;
      const headM = combined.match(/(?:hiring|added|growing by|expanded by)[^,\n]{0,30}(\d[\d,]+)\s+(?:employees|workers|people|jobs)/gi);
      if (headM) data.financialSignals.push(...headM.slice(0, 2).map(m => m.trim().slice(0, 120)));
    });
  }

  // EDGAR full-text layoff search
  const edgarUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22+%22layoff%22&forms=8-K&dateRange=custom&startdt=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}`;
  sources.push({ url: edgarUrl, type: 'sec', title: `SEC EDGAR - ${companyName} filings`, timestamp: new Date().toISOString() });

  // WARN Act — federally mandated mass layoff notices (50+ employees, 60-day advance notice)
  const warnQueries = [
    // Quote the company name to force exact-match — prevents matching partial names on listing pages
    `"${companyName}" WARN Act layoff notice site:warn.workforcegps.org OR site:edd.ca.gov OR site:labor.ny.gov`,
    `"${companyName}" WARN Act "mass layoff" OR "plant closing" filing`,
  ];
  const [warnRes1, warnRes2] = await Promise.all(warnQueries.map(q => searchWeb(q, 5)));
  for (const r of [...warnRes1, ...warnRes2]) {
    const text = `${r.title} ${r.snippet}`;
    if (/warn act|mass layoff|plant closing|workforce reduction/i.test(text)) {
      const dateM = text.match(/\b(20\d\d)\b/);
      // Only extract a worker count if it appears within 80 characters of the company name
      // in the snippet — prevents picking up aggregate page stats unrelated to this company
      let verifiedCount: string | null = null;
      const nameIdx = text.toLowerCase().indexOf(companyName.toLowerCase());
      if (nameIdx !== -1) {
        const nearby = text.slice(Math.max(0, nameIdx - 40), nameIdx + companyName.length + 80);
        const nearbyCount = nearby.match(/(\d[\d,]+)\s*(?:employees?|workers?|jobs?)/i);
        if (nearbyCount) verifiedCount = nearbyCount[0];
      }
      // Embed the source URL so Claude can use it as a clickable sourceUrl in the timeline
      const signal = `WARN Act filing: ${companyName}${verifiedCount ? ` — ${verifiedCount}` : ' (filing found — click source to verify count)'}${dateM ? ` (${dateM[1]})` : ''} [URL:${r.link}] [SOURCE:${r.title.slice(0, 60)}]`;
      if (!data.layoffSignals.some(s => s.includes(r.link))) data.layoffSignals.push(signal);
      sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
    }
  }
  // layoffs.fyi — crowd-sourced, comprehensive for tech layoffs
  const layoffsFyiRes = await searchWeb(`site:layoffs.fyi ${secCompanyQ} layoff`, 4);
  for (const r of layoffsFyiRes) {
    if (!r.link.includes('layoffs.fyi')) continue;
    const text = `${r.title} ${r.snippet}`;
    const countM = text.match(/(\d[\d,]+)\s*(?:employees?|workers?|jobs?|people)/i);
    const dateM = text.match(/\b(20\d\d)\b/);
    data.layoffSignals.push(`Layoffs.fyi: ${companyName}${countM ? ` — ${countM[0]} affected` : ''}${dateM ? ` (${dateM[1]})` : ''} [URL:${r.link}] [SOURCE:layoffs.fyi]`);
    sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }

  // Crunchbase — use context to disambiguate (e.g. "Meridian AI" not "Meridian Apps")
  const cbResults = await searchWeb(`site:crunchbase.com ${secCompanyQ} funding investors`, 5);
  for (const r of cbResults) {
    if (!r.link.includes('crunchbase.com')) continue;
    const text = `${r.title} ${r.snippet}`;
    const fundM = text.match(/\$[\d.]+\s*(?:B|M|billion|million)\s*(?:total funding|raised|in funding)/i);
    if (fundM) data.fundingSignals.push(`Crunchbase: ${fundM[0].trim()}`);
    const empM = text.match(/([\d,]+(?:-[\d,]+)?)\s*employees?/i);
    if (empM) data.financialSignals.push(`Crunchbase headcount: ${empM[1]} employees`);
    const invM = text.match(/(?:backed by|investors?(?:\s+include)?)[:\s]+([A-Z][^.]+(?:\.[^.]+){0,2})/i);
    if (invM) data.fundingSignals.push(`Investors: ${invM[1].trim().slice(0, 120)}`);
    sources.push({ url: r.link, type: 'crunchbase', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }

  // Pitchbook via Serper
  const pbResults = await searchWeb(`${secCompanyQ} site:pitchbook.com OR "pitchbook" ${secCompanyQ} funding employees`, 4);
  for (const r of pbResults) {
    const text = `${r.title} ${r.snippet}`;
    const fundM = text.match(/\$[\d.]+\s*(?:B|M|billion|million)/i);
    if (fundM) data.fundingSignals.push(`Pitchbook: ${r.title.slice(0, 80)} — ${fundM[0]}`);
    if (r.link.includes('pitchbook.com')) {
      sources.push({ url: r.link, type: 'crunchbase', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
    }
  }

  // LinkedIn company page via Serper
  const [liCompanyRes, liActivityRes] = await Promise.all([
    searchWeb(`site:linkedin.com/company ${secCompanyQ} employees`, 4),
    searchWeb(`${secCompanyQ} linkedin hiring layoffs headcount 2024 2025`, 4),
  ]);
  for (const r of [...liCompanyRes, ...liActivityRes]) {
    const text = `${r.title} ${r.snippet}`;
    const empM = text.match(/([\d,]+(?:-[\d,]+)?)\s*employees?/i);
    if (empM) data.financialSignals.push(`LinkedIn: ~${empM[1]} employees`);
    if (r.link.includes('linkedin.com/company')) {
      sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
    }
  }

  // BBB (Better Business Bureau) — complaint volume, rating, accreditation status
  // Consumer-facing companies with scam/quality issues surface here immediately
  const [bbbRes, ftcRes] = await Promise.all([
    searchWeb(`site:bbb.org "${companyName}" complaints reviews rating`, 4),
    searchWeb(`"${companyName}" site:ftc.gov OR "FTC" "${companyName}" enforcement complaint action`, 5),
  ]);
  for (const r of bbbRes) {
    if (!r.link.includes('bbb.org')) continue;
    const text = `${r.title} ${r.snippet}`;
    const ratingM = text.match(/([A-F][+-]?)\s*(?:rating|rated)/i);
    const complaintM = text.match(/([\d,]+)\s*complaints?/i);
    const accredM = /accredited/i.test(text);
    const signal = `BBB: ${companyName}${ratingM ? ` — ${ratingM[1]} rating` : ''}${complaintM ? `, ${complaintM[1]} complaints` : ''}${accredM ? ', accredited' : ', not listed as accredited'}`;
    data.financialSignals.push(signal);
    sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }
  for (const r of ftcRes) {
    const text = `${r.title} ${r.snippet}`;
    if (!/ftc\.gov|federal trade commission/i.test(r.link + text)) continue;
    const dateM = text.match(/\b(20\d\d)\b/);
    data.layoffSignals.push(`FTC action: ${r.title.slice(0, 80)}${dateM ? ` (${dateM[1]})` : ''} [URL:${r.link}] [SOURCE:FTC.gov]`);
    sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }

  // General Google search — top 10 results for company name
  // Catches: company website, Wikipedia, general press, Crunchbase overview, etc.
  const generalResults = await searchWeb(secCompanyQ, 10);
  for (const r of generalResults) {
    const text = `${r.title} ${r.snippet}`;
    // Extract any employee/funding signals not already captured
    const empM = text.match(/([\d,]+(?:-[\d,]+)?)\s*employees?/i);
    if (empM) data.financialSignals.push(`General: ~${empM[1]} employees`);
    const fundM = text.match(/\$[\d.]+\s*(?:B|M|billion|million)\s*(?:raised|funding|valuation|series)/i);
    if (fundM) data.fundingSignals.push(`General search: ${fundM[0].trim()}`);
    sources.push({ url: r.link, type: 'sec', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
  }

  // Parent company / subsidiary detection
  // Finds "acquired by", "division of", "subsidiary of", "owned by" relationships
  const parentResults = await searchWeb(
    `"${companyName}" "subsidiary of" OR "division of" OR "acquired by" OR "owned by" OR "parent company"`,
    6,
  );
  for (const r of parentResults) {
    const text = `${r.title} ${r.snippet}`;
    // Match: "subsidiary of X", "division of X", "acquired by X", etc.
    const parentM = text.match(
      /(?:subsidiary of|division of|acquired by|owned by|parent company[:\s]+|part of)\s+([A-Z][A-Za-z0-9\s,&.']+?)(?:\.|,|\s+(?:in|for|on|with|and)\s|$)/i,
    );
    if (parentM) {
      const parentName = parentM[1].trim().replace(/\s+/g, ' ').slice(0, 80);
      // Avoid matching the company itself or overly generic phrases
      if (
        parentName.split(' ').length >= 2 &&
        parentName.toLowerCase() !== companyName.toLowerCase() &&
        !/^(?:the|a|an|its|their|this|that)\s/i.test(parentName)
      ) {
        const existing = data.financialSignals.some(s => s.startsWith('Parent/Owner:'));
        if (!existing) {
          data.financialSignals.push(`Parent/Owner: ${parentName} [URL:${r.link}]`);
        }
      }
    }
  }

  return { data, sources };
}

// ── JOB POSTING ──────────────────────────────────────────────────────────────

// Sites that require JS/login — flag to user instead of returning blank
const LOGIN_WALL_DOMAINS = ['linkedin.com', 'indeed.com/viewjob'];

function detectLoginWall(url: string, html: string): boolean {
  const lower = url.toLowerCase();
  if (LOGIN_WALL_DOMAINS.some(d => lower.includes(d))) return true;
  // Generic login wall signals in HTML
  if (/sign.?in to|log.?in to view|create an account to|join to see/i.test(html.slice(0, 3000))) return true;
  return false;
}

// Extract JSON-LD structured data — most job boards embed this
function extractJsonLd(html: string): Partial<JobPostingData> {
  const result: Partial<JobPostingData> = {};
  const matches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    try {
      const json = JSON.parse(match[1]);
      const job = json['@type'] === 'JobPosting' ? json : (Array.isArray(json['@graph']) ? json['@graph'].find((n: {['@type']: string}) => n['@type'] === 'JobPosting') : null);
      if (!job) continue;
      if (job.title) result.title = job.title;
      if (job.hiringOrganization?.name) result.company = job.hiringOrganization.name;
      if (job.jobLocation?.address?.addressLocality) result.location = job.jobLocation.address.addressLocality + (job.jobLocation.address.addressRegion ? ', ' + job.jobLocation.address.addressRegion : '');
      if (job.datePosted) result.postedDate = job.datePosted;
      if (job.baseSalary?.value?.minValue) result.salaryRange = { min: job.baseSalary.value.minValue, max: job.baseSalary.value.maxValue };
      if (job.description) result.fullText = job.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
      if (job.jobLocationType === 'TELECOMMUTE') result.remotePolicy = 'Remote';
    } catch { /* skip bad JSON-LD */ }
  }
  return result;
}

export async function scrapeJobPosting(
  url: string
): Promise<{ data: JobPostingData; sources: ScrapedSource[]; loginWall?: boolean }> {
  const sources: ScrapedSource[] = [];

  const data: JobPostingData = {
    title: '',
    company: '',
    location: '',
    salaryRange: null,
    requirements: [],
    responsibilities: [],
    benefits: [],
    remotePolicy: 'Not specified',
    postedDate: '',
    fullText: '',
    isRepost: false,
  };

  const html = await fetchHtml(url, {
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  });

  if (!html) return { data, sources };

  // Detect login walls — tell the frontend to ask user to paste instead
  if (detectLoginWall(url, html)) {
    return { data: { ...data, fullText: '' }, sources, loginWall: true };
  }

  // Try JSON-LD first — cleanest data source
  const jsonLd = extractJsonLd(html);
  Object.assign(data, jsonLd);

  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, [aria-hidden="true"]').remove();

  // ATS-specific selectors (Greenhouse, Lever, Workday, Ashby, iCIMS)
  const titleSelectors = [
    '.job-title', '.posting-headline h2', '[data-ui="job-title"]',
    '[class*="JobTitle"]', '[class*="job_title"]', '[class*="jobtitle"]',
    'h1.title', 'h1[class*="title"]', 'h1',
  ];
  if (!data.title) {
    for (const sel of titleSelectors) {
      const t = $(sel).first().text().trim();
      if (t && t.length < 120) { data.title = t; break; }
    }
    if (!data.title) data.title = $('title').text().split(/[|\-–]/)[0].trim().slice(0, 100);
  }

  if (!data.company) {
    data.company = $(
      '[class*="company-name"], [class*="companyName"], [itemprop="hiringOrganization"], .employer-name, [data-company]'
    ).first().text().trim();
  }

  if (!data.location) {
    data.location = $(
      '[class*="location"], [itemprop="jobLocation"], [data-ui="job-location"], .posting-categories .sort-by-location'
    ).first().text().trim();
  }

  // Full text — prefer the job description container, fall back to body
  const descSelectors = [
    '#job-description', '.job-description', '[class*="jobDescription"]',
    '[class*="job-desc"]', '[data-ui="job-body"]', '.posting-description',
    '.description', 'article', 'main',
  ];
  let descText = '';
  for (const sel of descSelectors) {
    const el = $(sel).first();
    if (el.length) { descText = el.text().replace(/\s+/g, ' ').trim(); break; }
  }
  if (!descText) descText = $('body').text().replace(/\s+/g, ' ').trim();

  if (!data.fullText) data.fullText = descText.slice(0, 12000);

  const fullText = data.fullText;

  // Salary — only if not already from JSON-LD
  if (!data.salaryRange) {
    const m = fullText.match(/\$\s*([\d,]+)\s*[kK]?\s*(?:[-–—to]+)\s*\$?\s*([\d,]+)\s*[kK]?/);
    if (m) {
      let min = parseInt(m[1].replace(/,/g, ''));
      let max = parseInt(m[2].replace(/,/g, ''));
      if (min < 1000) { min *= 1000; max *= 1000; }
      if (max > min && max < 5000000) data.salaryRange = { min, max };
    }
  }

  // Remote policy
  if (!data.remotePolicy || data.remotePolicy === 'Not specified') {
    if (/\bfully remote\b|\bremote.?first\b/i.test(fullText)) data.remotePolicy = 'Remote';
    else if (/\bhybrid\b/i.test(fullText)) data.remotePolicy = 'Hybrid';
    else if (/on.?site|in.?office|in.?person|required to be in/i.test(fullText)) data.remotePolicy = 'On-site';
    else if (/remote/i.test(fullText)) data.remotePolicy = 'Remote (unconfirmed)';
  }

  // Requirements
  if (!data.requirements.length) {
    const m = fullText.match(/(?:require[dm]?s?|qualifications?|must have)[:\s]+([\s\S]{80,1200}?)(?=responsibilit|preferred|nice.to|benefit|about us|who we)/i);
    if (m) {
      data.requirements = m[1].split(/[•\n\-\*]/).map(s => s.trim()).filter(s => s.length > 8).slice(0, 12);
    }
  }

  // Responsibilities
  if (!data.responsibilities.length) {
    const m = fullText.match(/(?:responsibilit|you will|what you.ll do|role overview)[:\s]+([\s\S]{80,1200}?)(?=require|qualif|benefit|about us|who we)/i);
    if (m) {
      data.responsibilities = m[1].split(/[•\n\-\*]/).map(s => s.trim()).filter(s => s.length > 8).slice(0, 12);
    }
  }

  sources.push({
    url,
    type: 'job-posting',
    title: data.title || 'Job Posting',
    timestamp: new Date().toISOString(),
  });

  return { data, sources };
}

// ── FIND JOB POSTING URL ──────────────────────────────────────────────────────
// When a user pastes job text (no URL), use Serper to find the actual posting
// on a job board so we can get structured data like postedDate and salary.

const JOB_BOARD_RE = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|icims\.com|bamboohr\.com|breezy\.hr|jobvite\.com|recruitee\.com|workable\.com|taleo\.net|jobs\.lever\.co|boards\.greenhouse\.io/i;

export async function findJobPostingUrl(companyName: string, role: string): Promise<string | null> {
  if (!role || role.length > 80) return null;

  const queries = [
    `"${companyName}" "${role}" site:greenhouse.io OR site:boards.greenhouse.io OR site:lever.co OR site:jobs.lever.co OR site:ashbyhq.com`,
    `"${companyName}" "${role}" site:myworkdayjobs.com OR site:smartrecruiters.com OR site:icims.com OR site:bamboohr.com`,
    `"${companyName}" "${role}" job apply now 2024 2025`,
  ];

  for (const q of queries) {
    const results = await searchWeb(q, 5);
    const jobResult = results.find(r => JOB_BOARD_RE.test(r.link));
    if (jobResult) return jobResult.link;
  }
  return null;
}

// ─── EDGAR COMPANY FACTS ──────────────────────────────────────────────────────
// Fetches structured annual financials directly from SEC EDGAR (free, no auth).
// Returns null if company is not found or not public.

// Strip common legal suffixes so "StoneX" finds "StoneX Group Inc."
function edgarNameVariants(name: string): string[] {
  const stripped = name.replace(/\s+(Inc\.?|Corp\.?|LLC\.?|Ltd\.?|Group\s+Inc\.?|Group\.?|Co\.?|Holdings?\.?|Incorporated|Corporation|Limited)$/i, '').trim();
  const variants = new Set([name, stripped]);
  // Also try without trailing punctuation
  variants.add(name.replace(/[.,]+$/, '').trim());
  return [...variants].filter(v => v.length > 2);
}

async function findEdgarCIK(companyName: string, ua: string): Promise<string | null> {
  // Try EDGAR company search API (returns entity list, not document search)
  try {
    const res = await axios.get(
      `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K&dateRange=custom&startdt=2018-01-01`,
      { headers: { 'User-Agent': ua, Accept: 'application/json' }, timeout: 8000 },
    );
    const hits: Array<{ _source?: Record<string, unknown> }> = res.data?.hits?.hits ?? [];
    if (hits.length) {
      const src = hits[0]?._source ?? {};
      let cik = String(src.entity_id ?? '').replace(/^CIK/i, '');
      if (!cik) {
        const names: string[] = (src.display_names as string[]) ?? [];
        const m = names[0]?.match(/\((\d{7,10})\)/);
        if (m) cik = m[1];
      }
      if (cik) return cik;
    }
  } catch { /* fall through */ }

  // Fallback: try name variants with unquoted search
  for (const variant of edgarNameVariants(companyName)) {
    if (variant === companyName) continue; // already tried above
    try {
      const res = await axios.get(
        `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(variant)}%22&forms=10-K&dateRange=custom&startdt=2018-01-01`,
        { headers: { 'User-Agent': ua, Accept: 'application/json' }, timeout: 6000 },
      );
      const hits: Array<{ _source?: Record<string, unknown> }> = res.data?.hits?.hits ?? [];
      if (hits.length) {
        const src = hits[0]?._source ?? {};
        let cik = String(src.entity_id ?? '').replace(/^CIK/i, '');
        if (!cik) {
          const names: string[] = (src.display_names as string[]) ?? [];
          const m = names[0]?.match(/\((\d{7,10})\)/);
          if (m) cik = m[1];
        }
        if (cik) return cik;
      }
    } catch { /* skip */ }
  }

  // Last resort: EDGAR company name search endpoint
  try {
    const res = await axios.get(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(companyName)}&forms=10-K&dateRange=custom&startdt=2020-01-01`,
      { headers: { 'User-Agent': ua, Accept: 'application/json' }, timeout: 6000 },
    );
    const hits: Array<{ _source?: Record<string, unknown> }> = res.data?.hits?.hits ?? [];
    for (const hit of hits.slice(0, 3)) {
      const src = hit._source ?? {};
      const names: string[] = (src.display_names as string[]) ?? [];
      const entityName = String(src.entity_name ?? names[0] ?? '').toLowerCase();
      if (entityName.includes(companyName.toLowerCase())) {
        let cik = String(src.entity_id ?? '').replace(/^CIK/i, '');
        if (!cik) { const m = names[0]?.match(/\((\d{7,10})\)/); if (m) cik = m[1]; }
        if (cik) return cik;
      }
    }
  } catch { /* skip */ }

  return null;
}

async function fetchEdgarFacts(companyName: string): Promise<CompanyFactsData | null> {
  const EDGAR_UA = 'FairLadder.ai hello@fairladder.ai';
  try {
    // Step 1: Find CIK with fuzzy name matching + fallbacks
    const cikStr = await findEdgarCIK(companyName, EDGAR_UA);
    if (!cikStr) return { isPublic: false };

    const paddedCik = cikStr.padStart(10, '0');

    // Step 2: Fetch structured XBRL company facts
    const factsRes = await axios.get(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
      { headers: { 'User-Agent': EDGAR_UA, Accept: 'application/json' }, timeout: 12000 },
    );

    const facts = factsRes.data?.facts;
    if (!facts) return { isPublic: true };

    type FactEntry = { val: number; end: string; form: string };

    // Returns annual 10-K entries sorted newest first, for the first concept that has data
    const getAnnual = (ns: string, ...concepts: string[]): FactEntry[] => {
      for (const concept of concepts) {
        const units = facts[ns]?.[concept]?.units ?? {};
        const entries: FactEntry[] = (Object.values(units).flat() as FactEntry[])
          .filter(e => e.form === '10-K' || e.form === '10-K/A')
          .sort((a, b) => b.end.localeCompare(a.end));
        if (entries.length) return entries;
      }
      return [];
    };

    const revE  = getAnnual('us-gaap', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense');
    const niE   = getAnnual('us-gaap', 'NetIncomeLoss', 'ProfitLoss');
    const empE  = getAnnual('dei',     'EntityNumberOfEmployees');
    const cashE = getAnnual('us-gaap', 'CashAndCashEquivalentsAtCarryingValue', 'Cash');
    const debtE = getAnnual('us-gaap', 'LongTermDebt', 'LongTermDebtNoncurrent');

    return {
      isPublic: true,
      revenue:               revE[0]?.val,
      revenuePriorYear:      revE[1]?.val,
      netIncome:             niE[0]?.val,
      employeeCount:         empE[0]?.val,
      employeeCountPriorYear: empE[1]?.val,
      cashOnHand:            cashE[0]?.val,
      longTermDebt:          debtE[0]?.val,
      filingYear:            revE[0]?.end?.slice(0, 4) ?? empE[0]?.end?.slice(0, 4),
    };
  } catch {
    return null;
  }
}

// ─── COURTLISTENER ────────────────────────────────────────────────────────────
// Searches federal court records for employment/wage cases. Requires
// COURTLISTENER_TOKEN env var (free at courtlistener.com). Skips gracefully
// if token is absent.

async function fetchCourtListener(companyName: string): Promise<CourtCase[]> {
  const token = process.env.COURTLISTENER_KEY;
  if (!token) return [];

  type CLResult = {
    caseName?: string;
    court_id?: string;
    dateFiled?: string;
    absolute_url?: string;
    snippet?: string;
  };

  const queries = [
    `"${companyName}" employment discrimination retaliation`,
    `"${companyName}" wage overtime FLSA class action`,
  ];

  const batches = await Promise.all(
    queries.map(q =>
      axios
        .get('https://www.courtlistener.com/api/rest/v4/search/', {
          params: { q, type: 'r', filed_after: '2019-01-01', order_by: 'score desc', page_size: 5 },
          headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
          timeout: 8000,
        })
        .then(r => (r.data?.results ?? []) as CLResult[])
        .catch(() => [] as CLResult[]),
    ),
  );

  const seen = new Set<string>();
  const cases: CourtCase[] = [];

  for (const batch of batches) {
    for (const r of batch) {
      const title = r.caseName ?? '';
      if (!title || seen.has(title)) continue;
      seen.add(title);

      const combined = (title + (r.snippet ?? '')).toLowerCase();
      const caseType: CourtCase['caseType'] =
        /discriminat|harass|retaliat/.test(combined) ? 'discrimination' :
        /wage|overtime|flsa|unpaid/.test(combined) ? 'wage' :
        /securit|fraud|insider/.test(combined) ? 'securities' :
        'employment';

      cases.push({
        title,
        court: r.court_id ?? '',
        dateFiled: r.dateFiled?.slice(0, 10) ?? '',
        caseType,
        url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : '',
        snippet: r.snippet?.slice(0, 150),
      });
    }
  }

  return cases.slice(0, 8);
}

// ─── GITHUB ───────────────────────────────────────────────────────────────────
// Looks up a company's GitHub org to assess engineering culture signals.
// Uses GITHUB_KEY env var for higher rate limit (5k/hr vs 60/hr). Optional.

async function fetchGitHub(companyName: string): Promise<GitHubData | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'FairLadder.ai',
      Accept: 'application/vnd.github.v3+json',
    };
    if (process.env.GITHUB_KEY) headers['Authorization'] = `token ${process.env.GITHUB_KEY}`;

    // Search for matching org
    const searchRes = await axios.get('https://api.github.com/search/users', {
      params: { q: `${companyName} type:org`, per_page: 5 },
      headers,
      timeout: 8000,
    });

    const orgs: Array<{ login: string }> = searchRes.data?.items ?? [];
    if (!orgs.length) return null;

    // Find best match by normalizing names
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, '');
    const cn = norm(companyName);
    const bestOrg =
      orgs.find(o => norm(o.login) === cn) ??
      orgs.find(o => norm(o.login).includes(cn.slice(0, 5)) || cn.includes(norm(o.login).slice(0, 5))) ??
      orgs[0];

    if (!bestOrg) return null;

    // Fetch org info + recent repos in parallel
    const [orgRes, reposRes] = await Promise.all([
      axios.get(`https://api.github.com/orgs/${bestOrg.login}`, { headers, timeout: 6000 }),
      axios.get(`https://api.github.com/orgs/${bestOrg.login}/repos`, {
        params: { sort: 'pushed', per_page: 30, type: 'public' },
        headers,
        timeout: 6000,
      }),
    ]);

    type GHRepo = { pushed_at: string; language?: string; stargazers_count: number };
    const repos: GHRepo[] = reposRes.data ?? [];
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

    const langCounts: Record<string, number> = {};
    for (const r of repos) {
      if (r.language) langCounts[r.language] = (langCounts[r.language] ?? 0) + 1;
    }

    return {
      orgHandle: bestOrg.login,
      publicRepos: orgRes.data?.public_repos ?? repos.length,
      recentlyActive: repos.some(r => r.pushed_at > cutoff),
      lastPushDate: repos[0]?.pushed_at?.slice(0, 10),
      topLanguages: Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l),
      totalStars: repos.reduce((s, r) => s + (r.stargazers_count ?? 0), 0),
    };
  } catch {
    return null;
  }
}

// ─── NLRB ─────────────────────────────────────────────────────────────────────
// Searches NLRB case database for unfair labor practice complaints.
// Uses Serper — no additional API key needed.

// Domains that return aggregator/junk content unrelated to the searched company
const JUNK_DOMAINS = [
  'scribd.com', 'slideshare.net', 'studocu.com', 'coursehero.com',
  'academia.edu', 'docslib.org', 'issuu.com',
];

async function fetchNLRB(companyName: string): Promise<string[]> {
  const [nlrbSite, nlrbGeneral] = await Promise.all([
    searchWeb(`site:nlrb.gov "${companyName}"`, 5),
    searchWeb(`"${companyName}" NLRB "unfair labor practice" OR "union election" OR "labor board"`, 4),
  ]);

  const signals: string[] = [];
  const seen = new Set<string>();
  const companyLower = companyName.toLowerCase();

  for (const r of [...nlrbSite, ...nlrbGeneral]) {
    if (seen.has(r.link)) continue;
    seen.add(r.link);

    // Drop known junk aggregator domains
    if (JUNK_DOMAINS.some(d => r.link.includes(d))) continue;

    const snippetLower = (r.snippet ?? '').toLowerCase();
    const titleLower = r.title.toLowerCase();
    const fromNLRB = r.link.includes('nlrb.gov');

    const hasNLRBSignal =
      fromNLRB ||
      snippetLower.includes('nlrb') ||
      snippetLower.includes('unfair labor practice') ||
      (snippetLower.includes('labor board') && snippetLower.includes('union'));

    // Non-NLRB.gov results must mention the company name to avoid cross-contamination
    const mentionsCompany =
      fromNLRB ||
      snippetLower.includes(companyLower) ||
      titleLower.includes(companyLower);

    if (hasNLRBSignal && mentionsCompany) {
      signals.push(`${r.title}${r.snippet ? ` — ${r.snippet.slice(0, 120)}` : ''} [URL:${r.link}]`);
    }
  }

  return signals.slice(0, 5);
}

// ─── OSHA ─────────────────────────────────────────────────────────────────────
// Searches OSHA inspection and violation records via Serper.
// No additional API key needed.

async function fetchOSHA(companyName: string): Promise<string[]> {
  const [oshaSite, oshaGeneral] = await Promise.all([
    searchWeb(`site:osha.gov "${companyName}"`, 4),
    searchWeb(`"${companyName}" OSHA violation citation inspection penalty`, 4),
  ]);

  const signals: string[] = [];
  const seen = new Set<string>();
  const companyLower = companyName.toLowerCase();

  for (const r of [...oshaSite, ...oshaGeneral]) {
    if (seen.has(r.link)) continue;
    seen.add(r.link);

    if (JUNK_DOMAINS.some(d => r.link.includes(d))) continue;

    const snippetLower = (r.snippet ?? '').toLowerCase();
    const titleLower = r.title.toLowerCase();
    const fromOSHA = r.link.includes('osha.gov');

    const hasOSHASignal =
      fromOSHA ||
      snippetLower.includes('osha') ||
      snippetLower.includes('citation') ||
      (snippetLower.includes('violation') && snippetLower.includes('inspection'));

    const mentionsCompany =
      fromOSHA ||
      snippetLower.includes(companyLower) ||
      titleLower.includes(companyLower);

    if (hasOSHASignal && mentionsCompany) {
      signals.push(`${r.title}${r.snippet ? ` — ${r.snippet.slice(0, 120)}` : ''} [URL:${r.link}]`);
    }
  }

  return signals.slice(0, 5);
}

// ─── H-1B LCA ─────────────────────────────────────────────────────────────────
// Queries pre-loaded DOL H-1B Labor Condition Application data from Supabase.
// Returns aggregated wage stats for the company — null if table not populated.

async function fetchLCA(companyName: string): Promise<LCAData | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('lca_data')
      .select('job_title, annual_wage_from, annual_wage_to, city, state, decision_date')
      .ilike('employer_name', `%${companyName}%`)
      .not('annual_wage_from', 'is', null)
      .order('decision_date', { ascending: false })
      .limit(200);

    if (error || !data?.length) return null;

    const wages = data.map(r => r.annual_wage_from as number).sort((a, b) => a - b);
    const mid = Math.floor(wages.length / 2);
    const wageMedian = wages.length % 2 === 0
      ? Math.round((wages[mid - 1] + wages[mid]) / 2)
      : wages[mid];

    const roleMap: Record<string, number[]> = {};
    for (const r of data) {
      const t = (r.job_title as string || '').trim();
      if (!t) continue;
      if (!roleMap[t]) roleMap[t] = [];
      roleMap[t].push(r.annual_wage_from as number);
    }
    const topRoles = Object.entries(roleMap)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([title, ws]) => {
        const s = [...ws].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return { title, count: ws.length, medianWage: s.length % 2 === 0 ? Math.round((s[m-1]+s[m])/2) : s[m] };
      });

    const recentRecords: LCARecord[] = data.slice(0, 10).map(r => ({
      jobTitle: (r.job_title as string || '').trim(),
      annualWageFrom: r.annual_wage_from as number,
      annualWageTo: r.annual_wage_to as number | null,
      city: (r.city as string || '').trim(),
      state: (r.state as string || '').trim(),
      decisionDate: r.decision_date as string || '',
    }));

    return { sampleSize: data.length, wageMin: wages[0], wageMedian, wageMax: wages[wages.length - 1], topRoles, recentRecords };
  } catch {
    return null;
  }
}

// ─── ENRICHMENT ───────────────────────────────────────────────────────────────
// Aggregates free-API enrichment: EDGAR + CourtListener + GitHub + NLRB + OSHA + LCA.

export async function scrapeEnrichment(
  companyName: string,
): Promise<{ data: EnrichmentData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];

  // All six run in parallel
  const [companyFacts, courtCases, github, nlrbSignals, oshaSignals, lca] = await Promise.all([
    fetchEdgarFacts(companyName),
    fetchCourtListener(companyName),
    fetchGitHub(companyName),
    fetchNLRB(companyName),
    fetchOSHA(companyName),
    fetchLCA(companyName),
  ]);

  if (companyFacts?.isPublic) {
    sources.push({
      url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&action=getcompany&type=10-K`,
      type: 'sec',
      title: `${companyName} — SEC EDGAR 10-K`,
      timestamp: new Date().toISOString(),
    });
  }

  for (const c of courtCases) {
    if (c.url) {
      sources.push({
        url: c.url,
        type: 'sec',
        title: c.title.slice(0, 120),
        timestamp: c.dateFiled || new Date().toISOString(),
      });
    }
  }

  if (github?.orgHandle) {
    sources.push({
      url: `https://github.com/${github.orgHandle}`,
      type: 'sec',
      title: `${companyName} — GitHub`,
      timestamp: new Date().toISOString(),
    });
  }

  for (const signal of nlrbSignals) {
    const urlMatch = signal.match(/\[URL:(.*?)\]/);
    if (urlMatch?.[1]) {
      sources.push({
        url: urlMatch[1],
        type: 'sec',
        title: signal.split(' — ')[0].replace(/\[URL:.*?\]/, '').trim().slice(0, 120),
        timestamp: new Date().toISOString(),
      });
    }
  }

  for (const signal of oshaSignals) {
    const urlMatch = signal.match(/\[URL:(.*?)\]/);
    if (urlMatch?.[1]) {
      sources.push({
        url: urlMatch[1],
        type: 'sec',
        title: signal.split(' — ')[0].replace(/\[URL:.*?\]/, '').trim().slice(0, 120),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (lca) {
    sources.push({
      url: 'https://www.dol.gov/agencies/eta/foreign-labor/performance',
      type: 'sec',
      title: `${companyName} — H-1B LCA Wage Data (DOL)`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    data: {
      companyFacts: companyFacts ?? undefined,
      courtCases: courtCases.length > 0 ? courtCases : undefined,
      github: github ?? undefined,
      nlrbSignals: nlrbSignals.length > 0 ? nlrbSignals : undefined,
      oshaSignals: oshaSignals.length > 0 ? oshaSignals : undefined,
      lca: lca ?? undefined,
    },
    sources,
  };
}
