import { NextRequest, NextResponse } from 'next/server';
import { scrapeSEC } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const { companyName, companyContext } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const result = await scrapeSEC(companyName, companyContext);
  return NextResponse.json(result);
}
