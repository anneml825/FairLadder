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

  const queries = [
    `${companyName} layoffs OR "reduction in force" OR restructuring OR acquisition OR pivot`,
    `${companyName} CEO OR executives OR leadership OR "executive departure" OR resignation`,
    `${companyName} culture OR employees OR toxic OR "great place to work" OR reviews`,
    `${companyName} salary OR compensation OR pay OR raise OR bonus OR "pay cut"`,
    `${companyName} interview OR hiring OR "laid off" OR fired OR downsizing`,
    `${companyName} revenue OR earnings OR profit OR "quarterly results" OR IPO OR valuation`,
    `${companyName} funding OR "series A" OR "series B" OR "series C" OR investment OR "raised"`,
    `${companyName} "press release" OR announcement OR partnership OR product OR expansion`,
    `${companyName} lawsuit OR regulatory OR investigation OR fine OR SEC OR DOJ`,
    `${companyName} "return to office" OR RTO OR remote OR "work from home" OR hybrid`,
  ];

  // Add role-specific queries when a role is known
  if (role && role.length > 2) {
    queries.push(`${companyName} "${role}" team hiring department`);
    queries.push(`"${role}" ${companyName} salary pay compensation range`);
  }

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

      if (title && link) {
        results.push({
          title,
          url: link,
          summary: description,
          publishedAt: pubDate,
          source: source || 'Google News',
        });
        sources.push({
          url: link,
          type: 'google-news',
          title,
          timestamp: pubDate || new Date().toISOString(),
        });
      }
    });
  }

  return { results: results.slice(0, 100), sources: sources.slice(0, 100) };
}

// ── REDDIT ───────────────────────────────────────────────────────────────────
// Reddit's JSON API blocks datacenter IPs. We search DuckDuckGo and Google News
// for reddit.com results. DDG wraps links in redirect URLs (uddg= param) so we
// extract Reddit URLs via regex on raw HTML rather than href selectors.

const REDDIT_URL_RE = /https?:\/\/(?:www\.)?reddit\.com\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+\/[^"'\s<>&]*/g;

function extractRedditThreads(
  html: string,
  seen: Set<string>,
  threads: RedditThread[],
  sources: ScrapedSource[],
) {
  // 1. Regex the raw HTML — catches URLs inside DDG's uddg= redirect params too
  const rawUrls = [...new Set((html.match(REDDIT_URL_RE) || []).map(u => u.replace(/\/$/, '')))];

  // 2. Also decode any uddg= params to surface reddit URLs hidden in redirects
  const uddgRe = /uddg=(https?%3A%2F%2F[^&"'\s]+reddit[^&"'\s]+)/gi;
  for (const m of html.matchAll(uddgRe)) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (/reddit\.com\/r\/\w+\/comments\//.test(decoded)) rawUrls.push(decoded.replace(/\/$/, ''));
    } catch { /* skip */ }
  }

  // 3. Load cheerio to pair URLs with nearby title/snippet text
  const $ = cheerio.load(html);
  const linkTexts: Record<string, string> = {};
  const linkSnippets: Record<string, string> = {};
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    const snippet = $(el).closest('tr').next('tr').find('td').text().trim();
    // Check if href is or contains a reddit URL
    if (href.includes('reddit.com')) {
      const m = href.match(REDDIT_URL_RE);
      if (m) { linkTexts[m[0]] = text; linkSnippets[m[0]] = snippet; }
    }
    // Also match on link text that looks like a reddit thread title
    for (const url of rawUrls) {
      if (!linkTexts[url] && text.length > 8 && href.includes(encodeURIComponent('reddit.com'))) {
        linkTexts[url] = text;
        linkSnippets[url] = snippet;
      }
    }
  });

  for (const url of rawUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const title = linkTexts[url] || url.split('/').slice(-1)[0].replace(/_/g, ' ') || url;
    const snippet = linkSnippets[url] || '';
    const subredditM = url.match(/reddit\.com\/r\/([^/]+)/);
    threads.push({
      title: title.slice(0, 200), url,
      subreddit: subredditM?.[1] || 'reddit',
      score: 0, commentCount: 0,
      topComments: snippet ? [snippet.slice(0, 400)] : [],
      body: snippet.slice(0, 400),
    });
    sources.push({ url, type: 'reddit', title: title.slice(0, 120), timestamp: new Date().toISOString() });
  }
}

export async function scrapeReddit(
  companyName: string,
  role: string
): Promise<{ threads: RedditThread[]; sources: ScrapedSource[] }> {
  const threads: RedditThread[] = [];
  const sources: ScrapedSource[] = [];
  const seen = new Set<string>();

  // DuckDuckGo searches — "company reddit" style finds threads without site: restriction
  // which is more reliable than site:reddit.com on DDG Lite
  const ddgQueries = [
    `"${companyName}" reddit employees culture work experience`,
    `"${companyName}" reddit salary compensation pay`,
    `"${companyName}" reddit layoffs interview hiring`,
    role ? `"${companyName}" "${role}" reddit experience` : `"${companyName}" reddit career advice`,
  ];

  for (const q of ddgQueries) {
    const html = await fetchHtml(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
      { Referer: 'https://lite.duckduckgo.com/' }
    );
    if (html && html.length > 500) extractRedditThreads(html, seen, threads, sources);
  }

  // Google News RSS — surfaces Reddit posts that got news coverage + direct reddit links
  for (const q of [`"${companyName}" reddit`, `"${companyName}" site:reddit.com`]) {
    const rssXml = await fetchHtml(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    );
    if (rssXml) extractRedditThreads(rssXml, seen, threads, sources);
  }

  return { threads: threads.slice(0, 60), sources };
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

  // Strategy 1: DuckDuckGo web search — finds Glassdoor snippets without hitting Glassdoor directly
  const ddgQuery = `${companyName} glassdoor reviews rating employees`;
  const ddgHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ddgQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/', 'Accept-Language': 'en-US,en;q=0.9' }
  );
  if (ddgHtml && ddgHtml.length > 1000) {
    const plainText = ddgHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    // Extract overall rating
    const ratingM = plainText.match(/(\d\.\d)\s*(?:out of 5|stars?|\/5|rating)/i);
    if (ratingM) data.overallRating = parseFloat(ratingM[1]);

    // Extract review count
    const rcM = plainText.match(/([\d,]+)\s*reviews?/i);
    if (rcM) data.reviewCount = parseInt(rcM[1].replace(/,/g, ''));

    // Extract CEO approval
    const ceoM = plainText.match(/(\d+)%\s*(?:approve|approval)/i);
    if (ceoM) data.ceoApproval = parseInt(ceoM[1]);

    // Extract pros/cons from snippets
    const $d = cheerio.load(ddgHtml);
    $d('td, span, .result-snippet').each((_, el) => {
      const t = $d(el).text().trim();
      if (t.length < 30 || t.length > 350) return;
      const lower = t.toLowerCase();
      if (data.pros.length < 5 &&
        (lower.includes('great') || lower.includes('good culture') || lower.includes('benefits') ||
         lower.includes('opportunity') || lower.includes('learning') || lower.includes('flexible'))) {
        data.pros.push(t.slice(0, 200));
      }
      if (data.cons.length < 5 &&
        (lower.includes('bad') || lower.includes('poor management') || lower.includes('toxic') ||
         lower.includes('work-life') || lower.includes('underpaid') || lower.includes('turnover'))) {
        data.cons.push(t.slice(0, 200));
      }
    });

    sources.push({
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ddgQuery)}`,
      type: 'glassdoor',
      title: `${companyName} Reviews - Web Search`,
      timestamp: new Date().toISOString(),
    });
  }

  // CEO info and approval via DDG
  const ceoQuery = `${companyName} CEO leadership approval rating`;
  const ceoHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ceoQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (ceoHtml && ceoHtml.length > 1000) {
    const plain = ceoHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    // CEO name patterns: "CEO John Smith" or "John Smith, CEO"
    const ceoM =
      plain.match(/(?:CEO|Chief Executive)[,\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i) ||
      plain.match(/([A-Z][a-z]+ [A-Z][a-z]+)[,\s]+(?:is |as )?(?:CEO|Chief Executive)/i);
    if (ceoM) data.ceoName = ceoM[1].trim();
    if (!data.ceoApproval) {
      const approvalM = plain.match(/(\d+)%\s*(?:approve|approval|approved)/i);
      if (approvalM) data.ceoApproval = parseInt(approvalM[1]);
    }
    sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ceoQuery)}`, type: 'glassdoor', title: `${companyName} CEO & Leadership`, timestamp: new Date().toISOString() });
  }

  // Interview experience via DDG
  const intQuery = `${companyName} interview experience difficulty process questions`;
  const intHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(intQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (intHtml && intHtml.length > 1000) {
    const plain = intHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const diffM = plain.match(/interview[^0-9]*?(\d\.\d)\s*(?:\/5|out of|stars)/i);
    if (diffM) data.interviewDifficulty = parseFloat(diffM[1]);
    const posM = plain.match(/(\d+)%\s*(?:positive|good|had a positive)/i);
    if (posM) {
      const pos = parseInt(posM[1]);
      data.interviewExperience = { positive: pos, neutral: Math.max(0, 20 - Math.abs(pos - 60)), negative: 100 - pos };
    }
    // Pull 2-3 interview quote snippets
    const $int = cheerio.load(intHtml);
    $int('td, .result-snippet').each((_, el) => {
      const t = $int(el).text().trim();
      if (t.length > 40 && t.length < 300 &&
          /interview|hiring|process|question|round|offer/i.test(t) &&
          (data.interviewQuotes?.length ?? 0) < 3) {
        if (!data.interviewQuotes) data.interviewQuotes = [];
        data.interviewQuotes.push(t.slice(0, 250));
      }
    });
    sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(intQuery)}`, type: 'glassdoor', title: `${companyName} Interview Experience`, timestamp: new Date().toISOString() });
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

  // Search DuckDuckGo for company-specific salary data
  const companyQuery = `${companyName} ${role} salary compensation`;
  const ddgHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(companyQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (ddgHtml && ddgHtml.length > 1000) {
    const plain = ddgHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const salaries = extractSalaries(plain);
    if (salaries.length > 0) {
      const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
      data.targetRoleSalaries.push({ company: companyName, role, base: avg, totalComp: Math.round(avg * 1.3), location });
    }
    sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(companyQuery)}`, type: 'levels', title: `${companyName} ${role} Salary Search`, timestamp: new Date().toISOString() });
  }

  // Search Google News for salary articles mentioning the company/role
  const newsQuery = `${role} ${location} salary compensation 2024 2025`;
  const newsRss = `https://news.google.com/rss/search?q=${encodeURIComponent(newsQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const newsXml = await fetchHtml(newsRss);
  if (newsXml) {
    const $n = cheerio.load(newsXml, { xmlMode: true });
    $n('item').each((_, el) => {
      const desc = $n(el).find('description').text().replace(/<[^>]*>/g, '');
      const title = $n(el).find('title').text();
      const link = $n(el).find('link').text().trim() || $n(el).find('guid').text().trim();
      const salaries = extractSalaries(`${title} ${desc}`);
      if (salaries.length > 0 && data.comparableSalaries.length < 6) {
        const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
        const source = $n(el).find('source').text().trim() || 'News';
        data.comparableSalaries.push({ company: source, base: avg, totalComp: Math.round(avg * 1.3) });
      }
      if (link && data.comparableSalaries.length > 0) {
        sources.push({ url: link, type: 'levels', title: title.slice(0, 80), timestamp: new Date().toISOString() });
      }
    });
  }

  // Second DuckDuckGo search for broader market comps
  const marketQuery = `${role} average salary ${location} site:salary.com OR site:glassdoor.com OR site:builtin.com`;
  const ddg2Html = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(marketQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (ddg2Html && ddg2Html.length > 1000) {
    const $d = cheerio.load(ddg2Html);
    $d('a[href^="http"]').each((_, el) => {
      const href = $d(el).attr('href') || '';
      const snippet = $d(el).closest('tr').next('tr').text().trim();
      const salaries = extractSalaries(snippet);
      if (salaries.length > 0 && data.comparableSalaries.length < 8) {
        const avg = Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
        const compName = href.match(/(?:salary\.com|glassdoor\.com|builtin\.com)/)?.[0] || 'Market data';
        data.comparableSalaries.push({ company: compName, base: avg, totalComp: Math.round(avg * 1.3) });
        sources.push({ url: href, type: 'levels', title: `${role} Market Salary`, timestamp: new Date().toISOString() });
      }
    });
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

  // Strategy 1: DuckDuckGo → BLS pages include median wage in their search snippets
  // e.g. "The median annual wage for software developers was $127,260 in May 2023."
  const ddgQuery = `${role} median annual wage salary site:bls.gov`;
  const ddgHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ddgQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (ddgHtml && ddgHtml.length > 1000) {
    const plain = ddgHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    // "median annual wage for X was $127,260" or "median pay: $127,260"
    const medianM =
      plain.match(/median annual (?:wage|salary)[^$]*\$\s*([\d,]+)/i) ||
      plain.match(/median pay[^$]*\$\s*([\d,]+)/i) ||
      plain.match(/\$\s*([\d]{2,3},\d{3})\s*per year/i);
    if (medianM) {
      const val = parseInt(medianM[1].replace(/,/g, ''));
      if (val >= 25000 && val <= 600000) data.medianSalary = val;
    }

    sources.push({
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(ddgQuery)}`,
      type: 'bls',
      title: `${role} — BLS Wage Data`,
      timestamp: new Date().toISOString(),
    });
  }

  // Location-specific salary search
  if (location && location !== 'Remote') {
    const locQuery = `${role} salary ${location} average annual wage`;
    const locHtml = await fetchHtml(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(locQuery)}`,
      { Referer: 'https://lite.duckduckgo.com/' }
    );
    if (locHtml && locHtml.length > 1000) {
      const plain = locHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const locSalM = plain.match(/\$\s*([\d]{2,3},\d{3})\s*(?:per year|annually|average|median)/i);
      if (locSalM) {
        const val = parseInt(locSalM[1].replace(/,/g, ''));
        if (val >= 25000 && val <= 600000) data.locationData = `${location} average: $${val.toLocaleString()}`;
      }
      sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(locQuery)}`, type: 'bls', title: `${role} Salary in ${location}`, timestamp: new Date().toISOString() });
    }
  }

  // Strategy 2: BLS Occupational Outlook Handbook search (cleaner pages than OES table)
  if (!data.medianSalary) {
    const oohQuery = role.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
    const oohUrl = `https://www.bls.gov/ooh/occupation-finder.htm?pay=all&education=all&training=all&newjobs=all&growth=all&submit=GO&searchbar=${oohQuery}`;
    const oohHtml = await fetchHtml(oohUrl);
    if (oohHtml) {
      const $o = cheerio.load(oohHtml);
      // OOH pages contain "Median Pay" cells
      $o('table tbody tr').each((_, row) => {
        if (data.medianSalary) return;
        const cells = $o(row).find('td');
        const rowText = $o(row).text();
        const roleMatch = rowText.toLowerCase().includes(role.toLowerCase().split(' ')[0]);
        if (roleMatch) {
          const payCell = [...Array(cells.length).keys()]
            .map(i => $o(cells[i]).text().trim())
            .find(t => t.startsWith('$'));
          if (payCell) {
            const val = parseInt(payCell.replace(/[^0-9]/g, ''));
            if (val >= 25000 && val <= 600000) {
              data.medianSalary = val;
              data.occupationTitle = $o(cells[0]).text().trim() || role;
            }
          }
        }
      });
      if (data.medianSalary) {
        sources.push({ url: oohUrl, type: 'bls', title: 'BLS Occupational Outlook Handbook', timestamp: new Date().toISOString() });
      }
    }
  }

  // Derive percentiles from median using standard BLS distribution ratios
  if (data.medianSalary && !data.p25) {
    data.p10 = Math.round(data.medianSalary * 0.58);
    data.p25 = Math.round(data.medianSalary * 0.76);
    data.p75 = Math.round(data.medianSalary * 1.30);
    data.p90 = Math.round(data.medianSalary * 1.65);
  }

  return { data, sources };
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

  // Financial strength signals via DDG
  const finQuery = `${companyName} revenue profit financial results annual report 2024 2025`;
  const finHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(finQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (finHtml && finHtml.length > 1000) {
    const plain = finHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    // Revenue signals
    const revM = plain.match(/revenue[^$]*\$\s*([\d.]+)\s*(billion|million|B|M)\b/gi);
    if (revM) data.financialSignals.push(...revM.slice(0, 3).map(m => m.trim().slice(0, 120)));
    // Profit/loss
    const profitM = plain.match(/(?:profit|loss|net income)[^$\n]*\$\s*([\d.]+)\s*(?:billion|million)/gi);
    if (profitM) data.financialSignals.push(...profitM.slice(0, 2).map(m => m.trim().slice(0, 120)));
    sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(finQuery)}`, type: 'sec', title: `${companyName} Financial Results`, timestamp: new Date().toISOString() });
  }

  // Funding and investment history via DDG
  const fundQuery = `${companyName} funding raised investment series valuation crunchbase`;
  const fundHtml = await fetchHtml(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(fundQuery)}`,
    { Referer: 'https://lite.duckduckgo.com/' }
  );
  if (fundHtml && fundHtml.length > 1000) {
    const plain = fundHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const fundM = plain.match(/(?:raised|funding|series|invested)[^$\n]*\$\s*([\d.]+)\s*(?:billion|million|B|M)[^\n]*/gi);
    if (fundM) data.fundingSignals.push(...fundM.slice(0, 4).map(m => m.trim().slice(0, 150)));
    // Headcount signals
    const headM = plain.match(/(\d[\d,]+)\s+employees/gi);
    if (headM) data.financialSignals.push(...headM.slice(0, 2));
    sources.push({ url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(fundQuery)}`, type: 'sec', title: `${companyName} Funding & Investors`, timestamp: new Date().toISOString() });
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
