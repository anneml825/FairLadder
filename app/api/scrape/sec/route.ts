import { NextRequest, NextResponse } from 'next/server';
import { scrapeSEC } from '@/lib/scrapers';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const { companyName, companyContext, identityText } = await req.json();
  if (!companyName) return NextResponse.json({ error: 'companyName required' }, { status: 400 });

  const fallback = {
    data: {
      filings: [],
      layoffSignals: [],
      executiveDepartures: [],
      fundingSignals: [],
      financialSignals: [],
    },
    sources: [
      {
        url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&action=getcompany`,
        type: 'sec' as const,
        title: `${companyName} SEC EDGAR search`,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const result = await Promise.race([
    scrapeSEC(companyName, companyContext, identityText),
    new Promise<typeof fallback>(resolve => {
      setTimeout(() => resolve(fallback), 25000);
    }),
  ]);

  return NextResponse.json(result);
}
