import { NextRequest, NextResponse } from 'next/server';
import { scrapeJobPosting } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  const result = await scrapeJobPosting(url);
  return NextResponse.json(result);
}
