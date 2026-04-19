/**
 * Supabase-backed query cache for Serper search results.
 *
 * Schema (run once in your Supabase SQL editor):
 *
 *   create table if not exists serper_cache (
 *     query      text primary key,
 *     results    jsonb not null,
 *     cached_at  timestamptz not null default now()
 *   );
 *
 *   -- Optional: index for cleanup queries
 *   create index on serper_cache (cached_at);
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 * If either is missing the cache silently no-ops — Serper is called normally.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
}

// Lazy singleton — only created when env vars are present
let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { auth: { persistSession: false } },
    );
  }
  return _client;
}

/**
 * TTL for each query type in milliseconds. null = cache forever.
 *
 * Historical / immutable:
 *   SEC filings, WARN Act, layoffs.fyi, BBB, FTC, Crunchbase → forever
 *
 * Slowly changing:
 *   BLS.gov → 6 months
 *   Glassdoor, LinkedIn, Levels.fyi → 30 days
 *
 * Fast-changing:
 *   News / recent queries → 7 days
 *
 * Default → 14 days
 */
function getTTL(query: string): number | null {
  const q = query.toLowerCase();

  if (/site:sec\.gov|warn\s+act|site:layoffs\.fyi|site:bbb\.org|site:ftc\.gov/.test(q)) {
    return null; // immutable government/regulatory records
  }
  if (/site:crunchbase\.com|site:pitchbook\.com/.test(q)) {
    return null; // funding rounds don't un-happen
  }
  if (/site:bls\.gov/.test(q)) {
    return 180 * 86_400_000; // 6 months
  }
  if (/site:glassdoor\.com|site:linkedin\.com|site:levels\.fyi/.test(q)) {
    return 30 * 86_400_000; // 30 days
  }
  if (/\b(?:news|recent|last\s+\d+\s+days?|202[56])\b/.test(q)) {
    return 7 * 86_400_000; // 7 days — fresh news queries
  }
  return 14 * 86_400_000; // 14 days default
}

/** Return cached results if present and not stale, otherwise null. */
export async function getCachedQuery(query: string): Promise<SerpResult[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('serper_cache')
      .select('results, cached_at')
      .eq('query', query)
      .single();

    if (error || !data) return null;

    const ttl = getTTL(query);
    if (ttl !== null) {
      const ageMs = Date.now() - new Date(data.cached_at as string).getTime();
      if (ageMs > ttl) return null; // stale — let caller re-fetch
    }

    return data.results as SerpResult[];
  } catch {
    return null; // cache miss is always safe
  }
}

/** Persist results for a query (upsert — overwrites stale entries). */
export async function setCachedQuery(query: string, results: SerpResult[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client
      .from('serper_cache')
      .upsert(
        { query, results, cached_at: new Date().toISOString() },
        { onConflict: 'query' },
      );
  } catch {
    // Non-fatal — a cache write failure just means the next call hits Serper again
  }
}
