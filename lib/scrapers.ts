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
} from './types';

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
  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num },
      { headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, timeout: 12000 },
    );
    const results: Array<{ title?: string; link?: string; snippet?: string }> = res.data?.organic ?? [];
    return results
      .filter(r => r.link && r.title)
      .map(r => ({ title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' }));
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
  role?: string
): Promise<{ results: GoogleNewsResult[]; sources: ScrapedSource[] }> {
  const results: GoogleNewsResult[] = [];
  const sources: ScrapedSource[] = [];
  const seenUrls = new Set<string>();

  // 6 targeted, company-specific queries — quality over quantity.
  // Each query must return articles that are ABOUT the company, not just mentioning it in passing.
  const queries = [
    `"${companyName}" layoffs OR "job cuts" OR "reduction in force" OR downsizing OR restructuring`,
    `"${companyName}" acquisition OR merger OR IPO OR "going public" OR bankruptcy OR valuation`,
    `"${companyName}" earnings OR revenue OR profit OR "quarterly results" OR "financial results"`,
    `"${companyName}" CEO OR CFO OR CTO OR "executive departure" OR resignation OR leadership`,
    `"${companyName}" lawsuit OR investigation OR fine OR regulatory OR fraud OR NLRB`,
    `"${companyName}" employees OR culture OR "work environment" OR glassdoor OR "employee reviews"`,
  ];

  // Only add role query when role is a real job title (not a company tagline)
  if (role && role.length > 3 && role.length < 60 && !/connecting|talent|opportunity|markets/i.test(role)) {
    queries.push(`"${companyName}" "${role}" salary OR compensation OR hiring`);
  }

  // Keyword that must appear in title to keep the article — prevents off-topic noise.
  // Take the longest word in the company name as the anchor (e.g. "StoneX" from "StoneX Group").
  const companyWords = companyName.split(/\s+/).filter(w => w.length >= 4);
  const anchor = companyWords.sort((a, b) => b.length - a.length)[0]?.toLowerCase() || companyName.toLowerCase();

  for (const q of queries) {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await fetchHtml(rssUrl);
    if (!xml) continue;

    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();
      const source = $(el).find('source').text().trim();
      const description = $(el).find('description').text().replace(/<[^>]*>/g, '').trim().slice(0, 300);

      if (!title || !link || seenUrls.has(link)) return;

      // Only keep articles where the company name appears in the title (filters tangential noise)
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
): Promise<Array<{ title: string; url: string; subreddit: string; score: number; num_comments: number; selftext: string }>> {
  try {
    const base = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json`
      : `https://www.reddit.com/search.json`;
    const params = new URLSearchParams({ q: query, sort: 'relevance', t: 'year', limit: '10', ...(subreddit ? { restrict_sr: '1' } : {}) });
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
  role: string
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

  // Primary: Serper.dev — run all queries IN PARALLEL (was sequential, caused timeouts)
  // Use site: AND keyword-only variants so we find threads even when Google site: index is sparse
  const serpQueries = [
    `site:reddit.com "${companyName}" employees culture work experience`,
    `site:reddit.com "${companyName}" salary compensation pay`,
    `site:reddit.com "${companyName}" interview hiring layoffs`,
    `"${companyName}" reddit employees culture review`,          // no site: — catches more results
    role && role.length < 60
      ? `site:reddit.com "${companyName}" "${role}"`
      : `"${companyName}" reddit salary career`,
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
  role: string
): Promise<{ data: GlassdoorData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: GlassdoorData = {
    overallRating: null, ratingTrend: 'Unknown', ceoApproval: null,
    recommendToFriend: null, pros: [], cons: [], salaryData: null,
    interviewDifficulty: null, interviewExperience: null, reviewCount: null,
  };

  // Strategy 1: Serper targeted at Glassdoor — Google's cached snippets contain
  // rating numbers and partial review text that Glassdoor's own bot-detection hides.
  // Two queries: one broad, one site: restricted for review content.
  const glassdoorSearches = [
    `"${companyName}" glassdoor reviews rating culture employees`,
    `site:glassdoor.com "${companyName}" reviews`,
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
      // Track the first Glassdoor Reviews URL we find — try fetching it directly below
      if (!glassdoorDirectUrl && lower.includes('glassdoor.com') && (lower.includes('/reviews/') || lower.includes('-reviews-'))) {
        glassdoorDirectUrl = r.link;
        sources.push({ url: r.link, type: 'glassdoor', title: r.title.slice(0, 100), timestamp: new Date().toISOString() });
      } else if (lower.includes('comparably.com')) {
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
    sources.push({ url: comparablyReviewsUrl, type: 'glassdoor', title: `${companyName} Reviews - Comparably`, timestamp: new Date().toISOString() });
  }

  // Comparably CEO page
  if (!data.ceoName || !data.ceoApproval) {
    const comparablyCeoUrl = `https://www.comparably.com/companies/${comparablySlug}/ceo`;
    const ceoPageHtml = await fetchHtml(comparablyCeoUrl);
    if (ceoPageHtml && ceoPageHtml.length > 1000) {
      const $cc = cheerio.load(ceoPageHtml);
      const bodyText = $cc('body').text().replace(/\s+/g, ' ');
      const ceoNameM = bodyText.match(/([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:is|,)\s*(?:the\s+)?(?:CEO|Chief Executive)/i) ||
                       bodyText.match(/CEO\s+(?:of\s+\w+\s+)?(?:is\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/i);
      if (ceoNameM && !data.ceoName) data.ceoName = ceoNameM[1].trim();
      const approvalM = bodyText.match(/(\d+)%\s*(?:of employees|approve|positive)/i);
      if (approvalM && !data.ceoApproval) data.ceoApproval = parseInt(approvalM[1]);
      sources.push({ url: comparablyCeoUrl, type: 'glassdoor', title: `${companyName} CEO - Comparably`, timestamp: new Date().toISOString() });
    }
  }

  // Google News RSS — reputation, CEO, interview signals
  const repQuery = `"${companyName}" glassdoor OR comparably reviews rating culture employees`;
  const repRss = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(repQuery)}&hl=en-US&gl=US&ceid=US:en`);
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
    sources.push({ url: `https://news.google.com/rss/search?q=${encodeURIComponent(repQuery)}`, type: 'glassdoor', title: `${companyName} Reputation News`, timestamp: new Date().toISOString() });
  }

  const intRssQuery = `"${companyName}" interview process experience questions difficulty`;
  const intRss = await fetchHtml(`https://news.google.com/rss/search?q=${encodeURIComponent(intRssQuery)}&hl=en-US&gl=US&ceid=US:en`);
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
    sources.push({ url: `https://news.google.com/rss/search?q=${encodeURIComponent(intRssQuery)}`, type: 'glassdoor', title: `${companyName} Interview Data`, timestamp: new Date().toISOString() });
  }

  // Strategy 2: Indeed company reviews — structured page with JSON-LD
  if (!data.overallRating || data.pros.length === 0) {
    const indeedSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const indeedUrl = `https://www.indeed.com/cmp/${indeedSlug}/reviews`;
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

      sources.push({ url: indeedUrl, type: 'glassdoor', title: `${companyName} Reviews - Indeed`, timestamp: new Date().toISOString() });
    }
  }

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
export async function scrapeBLS(
  role: string,
  location?: string
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

  // ── Strategy 1 (PRIMARY): Serper web search across salary sites ──────────────
  // Salary aggregator sites (salary.com, payscale, glassdoor/Salaries, bls.gov) reliably
  // show dollar figures in Google search snippets — much more reliable than news summaries.
  const salarySearches = [
    `"${role}" average salary 2024 2025 site:salary.com OR site:payscale.com OR site:glassdoor.com`,
    `"${role}" median annual wage site:bls.gov`,
    `"${role}" average salary ${location || 'United States'} 2024`,
    `"${role}" salary comparably.com OR ziprecruiter.com OR builtin.com`,
  ];

  const allSalarySnippets: string[] = [];
  for (const q of salarySearches) {
    const results = await searchWeb(q, 8);
    if (results.length > 0) {
      allSalarySnippets.push(...results.map(r => `${r.title} ${r.snippet}`));
      for (const r of results.slice(0, 2)) {
        sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    }
    if (data.medianSalary) break; // stop once we have a figure
    const nums = extractSalariesFromText(allSalarySnippets.join(' '));
    if (nums.length > 0) {
      const sorted = nums.sort((a, b) => a - b);
      data.medianSalary = sorted[Math.floor(sorted.length / 2)]; // use median of found figures
    }
  }

  // Location premium — separate Serper search for location-specific figure
  if (location && location !== 'Remote' && !data.locationData) {
    const locResults = await searchWeb(`"${role}" salary "${location}" average 2024 2025`, 5);
    const locText = locResults.map(r => `${r.title} ${r.snippet}`).join(' ');
    const locNums = extractSalariesFromText(locText);
    if (locNums.length > 0) {
      const locMedian = locNums.sort((a, b) => a - b)[Math.floor(locNums.length / 2)];
      data.locationData = `${location} average: $${locMedian.toLocaleString()}`;
      for (const r of locResults.slice(0, 1)) {
        sources.push({ url: r.link, type: 'bls', title: r.title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    }
  }

  // ── Strategy 2: BLS Occupational Outlook Handbook (official government data) ──
  // Tries fuzzy-matching the role against BLS occupational categories.
  if (!data.medianSalary) {
    const oohQuery = role.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
    const oohUrl = `https://www.bls.gov/ooh/occupation-finder.htm?pay=all&education=all&training=all&newjobs=all&growth=all&submit=GO&searchbar=${oohQuery}`;
    const oohHtml = await fetchHtml(oohUrl);
    if (oohHtml) {
      const $o = cheerio.load(oohHtml);
      $o('table tbody tr').each((_, row) => {
        if (data.medianSalary) return;
        const cells = $o(row).find('td');
        const rowText = $o(row).text();
        // Match on ANY word from the role title (catches "Writers" for "Senior Copywriter")
        const roleWords = role.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const roleMatch = roleWords.some(w => rowText.toLowerCase().includes(w));
        if (roleMatch) {
          const payCell = [...Array(cells.length).keys()]
            .map(i => $o(cells[i]).text().trim())
            .find(t => /^\$[\d,]+/.test(t));
          if (payCell) {
            const val = parseInt(payCell.replace(/[^0-9]/g, ''));
            if (val >= 25000 && val <= 600000) {
              data.medianSalary = val;
              data.occupationTitle = $o(cells[0]).text().trim() || role;
              sources.push({ url: oohUrl, type: 'bls', title: 'BLS Occupational Outlook Handbook', timestamp: new Date().toISOString() });
            }
          }
        }
      });
    }
  }

  // ── Strategy 3: ZipRecruiter + Indeed salary pages (static, no JS) ───────────
  if (!data.medianSalary) {
    const roleSlug = role.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const zipUrl = `https://www.ziprecruiter.com/Salaries/${encodeURIComponent(role.replace(/\s+/g, '-'))}-Salary`;
    const zipHtml = await fetchHtml(zipUrl);
    if (zipHtml && zipHtml.length > 2000) {
      const $z = cheerio.load(zipHtml);
      const bodyText = $z('body').text().replace(/\s+/g, ' ');
      const nums = extractSalariesFromText(bodyText);
      if (nums.length > 0) {
        data.medianSalary = nums.sort((a, b) => a - b)[Math.floor(nums.length / 2)];
        sources.push({ url: zipUrl, type: 'bls', title: `${role} Salary — ZipRecruiter`, timestamp: new Date().toISOString() });
      }
    }
  }

  // Derive percentiles from median using standard wage distribution ratios
  if (data.medianSalary && !data.p25) {
    data.p10 = Math.round(data.medianSalary * 0.58);
    data.p25 = Math.round(data.medianSalary * 0.76);
    data.p75 = Math.round(data.medianSalary * 1.30);
    data.p90 = Math.round(data.medianSalary * 1.65);
  }

  return { data, sources };
}

function extractSalariesFromText(text: string): number[] {
  return extractSalaries(text);
}


// ── SEC EDGAR ────────────────────────────────────────────────────────────────
export async function scrapeSEC(
  companyName: string
): Promise<{ data: SECData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: SECData = {
    filings: [],
    layoffSignals: [],
    executiveDepartures: [],
    fundingSignals: [],
    financialSignals: [],
  };

  const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}&forms=8-K`;

  const html = await fetchHtml(searchUrl, {
    Accept: 'application/json',
    Referer: 'https://efts.sec.gov/',
  });

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
        const filingUrl = accNo
          ? `https://www.sec.gov/Archives/edgar/data/${src?.entity_id}/${accNo}/${accNo}-index.htm`
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
      }
    } catch { /* JSON parse error */ }
  }

  // Annual/Quarterly filings (10-K, 10-Q) — key for public companies
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  const annualUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&forms=10-K,10-Q&dateRange=custom&startdt=${oneYearAgo}&enddt=${today}`;
  const annualHtml = await fetchHtml(annualUrl, { Accept: 'application/json', Referer: 'https://efts.sec.gov/' });
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

  // Financial signals via Google News RSS
  const finQuery = `"${companyName}" revenue earnings profit financial results 2024 2025`;
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
  const fundQuery = `"${companyName}" funding raised investment series valuation`;
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

  // Also try EDGAR full-text search
  const edgarUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22+%22layoff%22&forms=8-K&dateRange=custom&startdt=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}&enddt=${new Date().toISOString().split('T')[0]}`;
  sources.push({
    url: edgarUrl,
    type: 'sec',
    title: `SEC EDGAR - ${companyName} filings`,
    timestamp: new Date().toISOString(),
  });

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
