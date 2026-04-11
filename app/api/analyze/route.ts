import { NextRequest } from 'next/server';
import {
  scrapeGoogleNews,
  scrapeReddit,
  scrapeGlassdoor,
  scrapeLevels,
  scrapeBLS,
  scrapeSEC,
  scrapeJobPosting,
} from '@/lib/scrapers';
import { runClaudeAnalysis } from '@/lib/claude';
import {
  AnalysisRequest,
  ScrapedSource,
  GlassdoorData,
  LevelsData,
  BLSData,
  SECData,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

function send(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: NextRequest) {
  const body: AnalysisRequest = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const allSources: ScrapedSource[] = [];
      let sourcesCount = 0;

      const progress = (step: string, status: 'running' | 'done' | 'error', count?: number, extra?: Record<string, unknown>) => {
        if (count !== undefined) sourcesCount += count;
        send(controller, { type: 'progress', step, status, sourcesCount, ...extra });
      };

      try {
        // Step 1: Job posting
        let jobPosting;
        if (body.jobUrl) {
          progress('Analyzing job posting...', 'running');
          const result = await scrapeJobPosting(body.jobUrl);
          jobPosting = result.data;
          allSources.push(...result.sources);
          progress('Job posting analyzed', 'done', result.sources.length);
        } else if (body.jobText) {
          progress('Processing job posting text...', 'running');
          jobPosting = {
            title: '',
            company: body.companyName,
            location: body.location,
            salaryRange: null,
            requirements: [],
            responsibilities: [],
            benefits: [],
            remotePolicy: 'Not specified',
            postedDate: '',
            fullText: body.jobText,
            isRepost: false,
          };
          progress('Job posting text processed', 'done', 1);
        }

        // Step 2: Google News
        progress('Scanning Google News...', 'running');
        const newsResult = await scrapeGoogleNews(body.companyName);
        allSources.push(...newsResult.sources);
        progress(`Google News scanned`, 'done', newsResult.results.length);

        // Step 3: Reddit
        progress('Reading Reddit threads...', 'running');
        const redditResult = await scrapeReddit(body.companyName, jobPosting?.title || '');
        allSources.push(...redditResult.sources);
        progress(`Reddit intelligence gathered`, 'done', redditResult.threads.length);

        // Step 4: Glassdoor
        progress('Scraping Glassdoor reviews...', 'running');
        const glassdoorResult = await scrapeGlassdoor(body.companyName, jobPosting?.title || '');
        allSources.push(...glassdoorResult.sources);
        progress(`Glassdoor data extracted`, 'done', glassdoorResult.sources.length);

        // Step 5: Levels.fyi
        progress('Checking Levels.fyi salary data...', 'running');
        const levelsResult = await scrapeLevels(body.companyName, jobPosting?.title || '', body.location);
        allSources.push(...levelsResult.sources);
        progress(`Levels.fyi data points found`, 'done', levelsResult.data.targetRoleSalaries.length + levelsResult.data.comparableSalaries.length);

        // Step 6: BLS
        progress('Pulling BLS salary statistics...', 'running');
        const blsResult = await scrapeBLS(jobPosting?.title || body.companyName);
        allSources.push(...blsResult.sources);
        progress(`BLS data retrieved`, 'done', blsResult.sources.length);

        // Step 7: SEC
        progress('Searching SEC filings...', 'running');
        const secResult = await scrapeSEC(body.companyName);
        allSources.push(...secResult.sources);
        progress(`SEC filings analyzed`, 'done', secResult.data.filings.length);

        // Step 8: Claude analysis
        progress('Running intelligence analysis...', 'running');

        const defaultGlassdoor: GlassdoorData = {
          overallRating: null, ratingTrend: 'N/A', ceoApproval: null,
          recommendToFriend: null, pros: [], cons: [], salaryData: null,
          interviewDifficulty: null, interviewExperience: null, reviewCount: null,
        };
        const defaultLevels: LevelsData = { targetRoleSalaries: [], comparableSalaries: [] };
        const defaultBLS: BLSData = {
          occupationTitle: jobPosting?.title || '', medianSalary: null,
          p10: null, p25: null, p75: null, p90: null,
          yearOverYearChange: 'N/A', locationData: '',
        };
        const defaultSEC: SECData = { filings: [], layoffSignals: [], executiveDepartures: [] };

        const result = await runClaudeAnalysis(
          body,
          {
            news: newsResult.results,
            reddit: redditResult.threads,
            glassdoor: glassdoorResult?.data || defaultGlassdoor,
            levels: levelsResult?.data || defaultLevels,
            bls: blsResult?.data || defaultBLS,
            sec: secResult?.data || defaultSEC,
            jobPosting,
          },
          allSources
        );

        progress('Analysis complete', 'done', 0);

        // Send final result
        send(controller, { type: 'result', data: result });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        send(controller, { type: 'error', message: errMsg });
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
