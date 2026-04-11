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

  return { results: results.slice(0, 40), sources: sources.slice(0, 40) };
}

// ── REDDIT ───────────────────────────────────────────────────────────────────
const SUBREDDITS = [
  'cscareerquestions', 'jobs', 'careerguidance', 'finance', 'medicine',
  'law', 'accounting', 'marketing', 'sales', 'humanresources',
  'techsupport', 'engineering',
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

  for (const sub of subsToSearch.slice(0, 8)) {
    const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(searchQuery)}&sort=top&limit=5&t=year`;
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
  const allRedditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(companyName)}&sort=top&limit=10&t=year`;
  try {
    const res = await axios.get(allRedditUrl, {
      headers: { ...HEADERS, Accept: 'application/json' },
      timeout: 10000,
    });
    const posts = res.data?.data?.children || [];
    for (const post of posts.slice(0, 10)) {
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

  return { threads: threads.slice(0, 30), sources };
}

// ── GLASSDOOR ────────────────────────────────────────────────────────────────
export async function scrapeGlassdoor(
  companyName: string,
  role: string
): Promise<{ data: GlassdoorData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];

  const searchUrl = `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(companyName)}&locT=N&locId=1`;

  // Try searching Glassdoor for the company
  const html = await fetchHtml(searchUrl, {
    Referer: 'https://www.glassdoor.com/',
    'sec-ch-ua': '"Chromium";v="122"',
  });

  // Default data structure (Glassdoor heavily anti-bots)
  const data: GlassdoorData = {
    overallRating: null,
    ratingTrend: 'Unable to determine',
    ceoApproval: null,
    recommendToFriend: null,
    pros: [],
    cons: [],
    salaryData: null,
    interviewDifficulty: null,
    interviewExperience: null,
    reviewCount: null,
  };

  if (html) {
    const $ = cheerio.load(html);

    // Try to extract rating from search results
    const ratingText = $('[data-test="rating-info"] .rating-info__rating').first().text().trim();
    const rating = parseFloat(ratingText);
    if (!isNaN(rating)) {
      data.overallRating = rating;
    }

    // Extract review count
    const reviewCountText = $('[data-test="rating-info"] .rating-info__count').first().text().trim();
    const reviewMatch = reviewCountText.match(/[\d,]+/);
    if (reviewMatch) {
      data.reviewCount = parseInt(reviewMatch[0].replace(/,/g, ''));
    }

    sources.push({
      url: searchUrl,
      type: 'glassdoor',
      title: `${companyName} on Glassdoor`,
      timestamp: new Date().toISOString(),
    });
  }

  // Try to get more data from the company overview page
  const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const overviewUrl = `https://www.glassdoor.com/Overview/Working-at-${companySlug}-EI_IE.htm`;
  const overviewHtml = await fetchHtml(overviewUrl);

  if (overviewHtml) {
    const $ = cheerio.load(overviewHtml);

    // Try multiple selectors for rating
    const selectors = [
      '.rating-headline-average',
      '.ratingValue',
      '[data-test="rating"]',
      '.css-1pmc6te',
    ];
    for (const sel of selectors) {
      const text = $(sel).first().text().trim();
      const val = parseFloat(text);
      if (!isNaN(val) && val >= 1 && val <= 5) {
        data.overallRating = val;
        break;
      }
    }

    // Extract pros and cons from reviews
    $('[data-test="pros"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10) data.pros.push(text.slice(0, 200));
    });
    $('[data-test="cons"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10) data.cons.push(text.slice(0, 200));
    });

    // CEO approval
    const ceoText = $('[data-test="ceo-approval"]').text().trim();
    const ceoMatch = ceoText.match(/(\d+)%/);
    if (ceoMatch) data.ceoApproval = parseInt(ceoMatch[1]);

    // Recommend to friend
    const recText = $('[data-test="recommend"]').text().trim();
    const recMatch = recText.match(/(\d+)%/);
    if (recMatch) data.recommendToFriend = parseInt(recMatch[1]);

    sources.push({
      url: overviewUrl,
      type: 'glassdoor',
      title: `${companyName} Overview - Glassdoor`,
      timestamp: new Date().toISOString(),
    });
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
      for (const hit of hits.slice(0, 10)) {
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
export async function scrapeJobPosting(
  url: string
): Promise<{ data: JobPostingData; sources: ScrapedSource[] }> {
  const sources: ScrapedSource[] = [];
  const html = await fetchHtml(url);

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

  if (!html) return { data, sources };

  const $ = cheerio.load(html);

  // Remove script/style tags
  $('script, style, nav, footer, header').remove();

  // Generic extraction
  const fullText = $('body').text().replace(/\s+/g, ' ').trim();
  data.fullText = fullText.slice(0, 8000);

  // Try to extract title from various job sites
  data.title =
    $('h1.jobTitle, h1.job-title, [data-testid="jobTitle"], .jobTitle, h1').first().text().trim().slice(0, 100) ||
    $('title').text().split('|')[0].trim().slice(0, 100);

  data.company =
    $('[data-testid="employer-name"], .companyName, .employer-name, [itemprop="hiringOrganization"]').first().text().trim() || '';

  data.location =
    $('[data-testid="job-location"], .jobLocation, .location, [itemprop="jobLocation"]').first().text().trim() || '';

  // Salary extraction
  const salaryMatch = fullText.match(/\$?([\d,]+)[kK]?\s*[-–—to]+\s*\$?([\d,]+)[kK]?\s*(per year|\/yr|annual|a year)?/i);
  if (salaryMatch) {
    let min = parseInt(salaryMatch[1].replace(/,/g, ''));
    let max = parseInt(salaryMatch[2].replace(/,/g, ''));
    if (min < 1000) { min *= 1000; max *= 1000; }
    data.salaryRange = { min, max };
  }

  // Remote policy
  if (/remote/i.test(fullText)) data.remotePolicy = 'Remote';
  else if (/hybrid/i.test(fullText)) data.remotePolicy = 'Hybrid';
  else if (/on.?site|in.?office|in.?person/i.test(fullText)) data.remotePolicy = 'On-site';

  // Extract requirements section
  const reqSection = fullText.match(/(?:require[dm]?|qualification)[:\s]+([\s\S]{100,800}?)(?=responsibilit|benefit|about|what you|preferred|nice)/i);
  if (reqSection) {
    data.requirements = reqSection[1]
      .split(/[\n•\-\*]/)
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
  }

  // Extract responsibilities
  const respSection = fullText.match(/responsibilit[yi][e]?[s]?[:\s]+([\s\S]{100,800}?)(?=require|qualif|benefit|about|what you)/i);
  if (respSection) {
    data.responsibilities = respSection[1]
      .split(/[\n•\-\*]/)
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, 10);
  }

  sources.push({
    url,
    type: 'job-posting',
    title: data.title || 'Job Posting',
    timestamp: new Date().toISOString(),
  });

  return { data, sources };
}
