import { NextRequest, NextResponse } from 'next/server';
import { scrapeJobPosting, findJobPostingUrl } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { url, companyName, role, companyContext, jobText } = await req.json();

  // Direct URL scrape
  if (url) {
    const result = await scrapeJobPosting(url);
    return NextResponse.json(result);
  }

  // No URL — try to find the posting in the wild via Serper
  if (companyName && role) {
    const foundUrl = await findJobPostingUrl(companyName, role, companyContext, jobText);
    if (foundUrl) {
      const result = await scrapeJobPosting(foundUrl);
      // Return found URL so frontend can surface it
      return NextResponse.json({ ...result, foundUrl });
    }
    // Couldn't find posting — return empty with no loginWall flag
    return NextResponse.json({ data: { title: role, company: companyName, location: '', salaryRange: null, requirements: [], responsibilities: [], benefits: [], remotePolicy: 'Not specified', postedDate: '', fullText: '', isRepost: false }, sources: [] });
  }

  return NextResponse.json({ error: 'url or companyName+role required' }, { status: 400 });
}
