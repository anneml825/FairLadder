import { NextRequest, NextResponse } from 'next/server';
import { scrapeGlassdoor } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const { companyName, role } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeGlassdoor(companyName, role || '');
  return NextResponse.json(result);
}
