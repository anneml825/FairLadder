import { NextRequest, NextResponse } from 'next/server';
import { scrapeEnrichment } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { companyName } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeEnrichment(companyName);
  return NextResponse.json(result);
}
