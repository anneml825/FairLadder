import { NextRequest, NextResponse } from 'next/server';
import { extractJobPostingFromText, findJobPostingUrl, scrapeJobPosting } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 25;

function emptyJob(companyName = '', role = '') {
  return {
    title: role,
    company: companyName,
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
}

export async function POST(req: NextRequest) {
  try {
    const { url, companyName, role, companyContext, jobText } = await req.json();

    if (url) {
      const result = await scrapeJobPosting(url, { timeoutMs: 12000 });
      return NextResponse.json(result);
    }

    if (companyName && role && typeof jobText === 'string' && jobText.trim().length > 200) {
      return NextResponse.json({
        data: extractJobPostingFromText(jobText, companyName, role),
        sources: [],
      });
    }

    if (companyName && role) {
      const foundUrl = await findJobPostingUrl(companyName, role, companyContext, jobText);
      if (foundUrl) {
        const result = await scrapeJobPosting(foundUrl, { timeoutMs: 12000 });
        return NextResponse.json({ ...result, foundUrl });
      }

      return NextResponse.json({ data: emptyJob(companyName, role), sources: [] });
    }

    return NextResponse.json({ error: 'url or companyName+role required' }, { status: 400 });
  } catch {
    return NextResponse.json({ data: emptyJob(), sources: [] });
  }
}
