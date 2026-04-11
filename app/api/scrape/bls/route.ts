import { NextRequest, NextResponse } from 'next/server';
import { scrapeBLS } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const { role } = await req.json();
  if (!role) return NextResponse.json({ error: 'role required' }, { status: 400 });

  const result = await scrapeBLS(role);
  return NextResponse.json(result);
}
