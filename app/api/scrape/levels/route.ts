import { NextRequest, NextResponse } from 'next/server';
import { scrapeLevels } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 40;

export async function POST(req: NextRequest) {
  const { companyName, role, location, companyContext } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeLevels(companyName, role || '', location || '', companyContext);
  return NextResponse.json(result);
}
