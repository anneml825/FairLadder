import { NextRequest, NextResponse } from 'next/server';
import { scrapeReddit } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 25;

export async function POST(req: NextRequest) {
  const { companyName, role, companyContext, identityText } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeReddit(companyName, role || '', companyContext, identityText);
  return NextResponse.json(result);
}
