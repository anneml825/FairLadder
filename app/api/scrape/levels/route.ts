import { NextRequest, NextResponse } from 'next/server';
import { scrapeLevels } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 25;

export async function POST(req: NextRequest) {
  const { companyName, role, location } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeLevels(companyName, role || '', location || '');
  return NextResponse.json(result);
}
