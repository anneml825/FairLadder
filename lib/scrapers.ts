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
  companyName: string
): Promise<{ results: GoogleNewsResult[]; sources: ScrapedSource[] }> {
  const results: GoogleNewsResult[] = [];
  const sources: ScrapedSource[] = [];

  const queries = [
    `${companyName} layoffs OR scandal OR lawsuit OR funding OR leadership OR acquisition OR pivot OR CEO OR executives`,
    `${companyName} review OR culture OR employees OR toxic OR "great place to work"`,
    `${companyName} salary OR compensation OR pay OR raise OR bonus`,
    `${companyName} interview OR hiring OR fired OR laid off OR restructuring`,
    `${companyName} remote work OR "return to office" OR "work from home" OR RTO`,
  ];

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
const SUBREDDITS = [
  'cscareerquestions', 'jobs', 'careerguidance', 'finance', 'medicine',
  'law', 'accounting', 'marketing', 'sales', 'humanresources',
  'techsupport', 'engineering', 'devops', 'datascience', 'MachineLearning',
  'recruiting', 'layoffs', 'WorkReform', 'antiwork', 'personalfinance',
];

export async function scrapeReddit(
  companyName: string,
  role: string
): Promise<{ threads: RedditThread[]; sources: ScrapedSource[] }> {
  const threads: RedditThread[] = [];
  const sources: ScrapedSource[] = [];

  // Try company-specific subreddit first
  const companySub = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const subsToSearch = [companySub, ...SUBREDDITS];

  // Search Reddit JSON API (public, no auth needed for basic search)
  const searchQuery = `${companyName} ${role}`.slice(0, 100);

  for (const sub of subsToSearch) {
    const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(searchQuery)}&sort=top&limit=10&t=year`;
    try {
      const res = await axios.get(url, {
        headers: {
          ...HEADERS,
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      const posts = res.data?.data?.children || [];
      for (const post of posts) {
        const p = post.data;
        if (!p?.title) continue;

        const threadUrl = `https://www.reddit.com${p.permalink}`;
        const topComments: string[] = [];

        // Fetch top comments for the most relevant threads
        if (threads.length < 15) {
          try {
            const commentsRes = await axios.get(`${threadUrl}.json?sort=top&limit=5`, {
              headers: { ...HEADERS, Accept: 'application/json' },
              timeout: 8000,
            });
            const commentData = commentsRes.data?.[1]?.data?.children || [];
            for (const c of commentData.slice(0, 5)) {
              const body = c.data?.body;
              if (body && body.length > 20 && body !== '[removed]' && body !== '[deleted]') {
                topComments.push(body.slice(0, 500));
              }
            }
          } catch { /* skip comment fetch */ }
        }

        threads.push({
          title: p.title,
          url: threadUrl,
          subreddit: p.subreddit,
          score: p.score || 0,
          commentCount: p.num_comments || 0,
          topComments,
          body: p.selftext?.slice(0, 500),
        });

        sources.push({
          url: threadUrl,
          type: 'reddit',
          title: p.title,
          timestamp: new Date((p.created_utc || 0) * 1000).toISOString(),
        });
      }
    } catch { /* skip failed subreddit */ }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  // Also search all of Reddit
  const allRedditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(companyName)}&sort=top&limit=25&t=year`;
  try {
    const res = await axios.get(allRedditUrl, {
      headers: { ...HEADERS, Accept: 'application/json' },
      timeout: 10000,
    });
    const posts = res.data?.data?.children || [];
    for (const post of posts.slice(0, 25)) {
      const p = post.data;
      if (!p?.title) continue;
      const threadUrl = `https://www.reddit.com${p.permalink}`;
      if (!threads.find(t => t.url === threadUrl)) {
        threads.push({
          title: p.title,
          url: threadUrl,
          subreddit: p.subreddit,
          score: p.score || 0,
          commentCount: p.num_comments || 0,
          topComments: [],
          body: p.selftext?.slice(0, 300),
        });
        sources.push({
          url: threadUrl,
          type: 'reddit',
          title: p.title,
          timestamp: new Date((p.created_utc || 0) * 1000).toISOString(),
        });
      }
    }
  } catch { /* skip */ }

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

  // Strategy 1: Google News RSS to find the actual Glassdoor URL
  const googleRss = `https://news.google.com/rss/search?q=site:glassdoor.com+"${encodeURIComponent(companyName)}"&hl=en-US&gl=US&ceid=US:en`;
  const rssHtml = await fetchHtml(googleRss);
  let glassdoorUrl = '';
  if (rssHtml) {
    const $rss = cheerio.load(rssHtml, { xmlMode: true });
    $rss('item link, item guid').each((_, el) => {
      const href = $rss(el).text().trim();
      if (href.includes('glassdoor.com/Overview') || href.includes('glassdoor.com/Reviews')) {
        glassdoorUrl = href;
        return false;
      }
    });
  }

  // Strategy 2: Try common slug patterns
  if (!glassdoorUrl) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const slugNoDash = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidates = [
      `https://www.glassdoor.com/Reviews/${slug}-Reviews-E.htm`,
      `https://www.glassdoor.com/Overview/Working-at-${slug}-EI_IE.htm`,
      `https://www.glassdoor.com/Reviews/${slugNoDash}-Reviews-E.htm`,
    ];
    for (const c of candidates) {
      const h = await fetchGlassdoor(c);
      if (h && h.length > 5000 && !h.includes('Page Not Found') && !h.includes('no results')) {
        glassdoorUrl = c;
        parseGlassdoorHtml(h, data, c, sources, companyName);
        break;
      }
    }
  } else {
    const h = await fetchGlassdoor(glassdoorUrl);
    if (h) parseGlassdoorHtml(h, data, glassdoorUrl, sources, companyName);
  }

  // Strategy 3: Indeed company reviews as fallback
  if (!data.overallRating) {
    const indeedSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const indeedUrl = `https://www.indeed.com/cmp/${indeedSlug}/reviews`;
    const indeedHtml = await fetchHtml(indeedUrl, { Referer: 'https://www.indeed.com/' });
    if (indeedHtml && indeedHtml.length > 3000) {
      const $i = cheerio.load(indeedHtml);
      const ratingText = $i('[data-testid="rating-number"], .css-1aq5k5r, [itemprop="ratingValue"]').first().text().trim();
      const rating = parseFloat(ratingText);
      if (!isNaN(rating) && rating >= 1 && rating <= 5) data.overallRating = rating;

      const rcText = $i('[data-testid="review-count"]').first().text().trim();
      const rcM = rcText.match(/[\d,]+/);
      if (rcM) data.reviewCount = parseInt(rcM[0].replace(/,/g, ''));

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

// ── LEVELS.FYI ───────────────────────────────────────────────────────────────
export async function scrapeLevels(
  companyName: string,
  role: string,
  location: string
): Promise<{ data: LevelsData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const data: LevelsData = {
    targetRoleSalaries: [],
    comparableSalaries: [],
  };

  const companySlug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const url = `https://www.levels.fyi/companies/${companySlug}/salaries/`;

  const html = await fetchHtml(url);
  if (html) {
    const $ = cheerio.load(html);

    sources.push({
      url,
      type: 'levels',
      title: `${companyName} Salaries - Levels.fyi`,
      timestamp: new Date().toISOString(),
    });

    // Extract salary rows
    $('table tbody tr, [data-testid="salary-row"]').each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 3) {
        const roleText = $(cells[0]).text().trim();
        const baseText = $(cells[1]).text().trim().replace(/[^0-9]/g, '');
        const totalText = $(cells[2]).text().trim().replace(/[^0-9]/g, '');

        const base = parseInt(baseText);
        const total = parseInt(totalText);

        if (!isNaN(base) && base > 0) {
          const isTargetRole = roleText.toLowerCase().includes(role.toLowerCase().split(' ')[0]);
          if (isTargetRole) {
            data.targetRoleSalaries.push({
              company: companyName,
              role: roleText,
              base,
              totalComp: total || base,
              location,
            });
          }
        }
      }
    });

    // Try to scrape comparable company data
    const compareUrl = `https://www.levels.fyi/salary/${encodeURIComponent(role)}/`;
    const compareHtml = await fetchHtml(compareUrl);
    if (compareHtml) {
      const $2 = cheerio.load(compareHtml);
      $2('table tbody tr').each((_, el) => {
        const cells = $2(el).find('td');
        if (cells.length >= 3) {
          const comp = $2(cells[0]).text().trim();
          const base = parseInt($2(cells[1]).text().trim().replace(/[^0-9]/g, ''));
          const total = parseInt($2(cells[2]).text().trim().replace(/[^0-9]/g, ''));
          if (comp && !isNaN(base) && base > 0) {
            data.comparableSalaries.push({ company: comp, base, totalComp: total || base });
          }
        }
      });

      sources.push({
        url: compareUrl,
        type: 'levels',
        title: `${role} Salaries - Levels.fyi`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return { data, sources };
}

// ── BLS ──────────────────────────────────────────────────────────────────────
export async function scrapeBLS(
  role: string
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

  // BLS Occupational Employment and Wage Statistics
  const blsUrl = `https://www.bls.gov/oes/current/oes_nat.htm`;
  const html = await fetchHtml(blsUrl);

  if (html) {
    const $ = cheerio.load(html);
    const roleKeyword = role.toLowerCase().split(' ').slice(0, 2).join(' ');

    // Search for matching occupation
    $('table tbody tr').each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length >= 5) {
        const occTitle = $(cells[0]).text().trim().toLowerCase();
        if (occTitle.includes(roleKeyword) || roleKeyword.includes(occTitle.split(' ')[0])) {
          const median = parseInt($(cells[4]).text().trim().replace(/[^0-9]/g, ''));
          const p10 = parseInt($(cells[1]).text().trim().replace(/[^0-9]/g, ''));
          const p25 = parseInt($(cells[2]).text().trim().replace(/[^0-9]/g, ''));
          const p75 = parseInt($(cells[5]).text().trim().replace(/[^0-9]/g, ''));
          const p90 = parseInt($(cells[6]).text().trim().replace(/[^0-9]/g, ''));

          if (!isNaN(median) && median > 0) {
            data.occupationTitle = $(cells[0]).text().trim();
            data.medianSalary = median;
            if (!isNaN(p10)) data.p10 = p10;
            if (!isNaN(p25)) data.p25 = p25;
            if (!isNaN(p75)) data.p75 = p75;
            if (!isNaN(p90)) data.p90 = p90;
            return false; // break
          }
        }
      }
    });

    sources.push({
      url: blsUrl,
      type: 'bls',
      title: 'BLS Occupational Employment Statistics',
      timestamp: new Date().toISOString(),
    });
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
