import { CompanyIdentity } from './types';

function cleanEntityName(value: string): string {
  return value
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:()\-]+|[\s,.;:()\-]+$/g, '')
    .trim();
}

function extractHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function inferBrandDomain(companyName: string, jobUrl?: string): string | undefined {
  const host = extractHostname(jobUrl);
  if (!host) return undefined;
  if (/greenhouse|lever|workday|ashby|smartrecruiters|icims|bamboohr|jobvite|recruitee|workable/i.test(host)) return undefined;
  if (companyName && host.includes(companyName.toLowerCase().replace(/[^a-z0-9]/g, ''))) return host;
  return host;
}

const RELATION_PATTERNS = [
  /(?:wholly owned subsidiary|subsidiary|affiliate)\s+of\s+([A-Z][A-Za-z0-9&.,' -]{2,80})/i,
  /(?:a|an)\s+(?:brand|division|subsidiary|platform|product|service)\s+of\s+([A-Z][A-Za-z0-9&.,' -]{2,80})/i,
  /(?:operated by|owned by|part of|backed by|under)\s+([A-Z][A-Za-z0-9&.,' -]{2,80})/i,
  /(?:member of|registered with|introduced by)\s+([A-Z][A-Za-z0-9&.,' -]{2,80})/i,
  /([A-Z][A-Za-z0-9&.,' -]{2,80})\s+(?:is the parent company of|owns|operates)\s+[A-Z][A-Za-z0-9&.,' -]{2,80}/i,
];

const PARENT_SUFFIX_RE = /\b(holdings?|group|inc\.?|corporation|corp\.?|limited|ltd\.?|llc|plc)\b/i;

function inferLegalEntityFromText(jobText: string, employerBrand: string): string | undefined {
  const compactText = jobText.replace(/\s+/g, ' ').trim();
  const escapedBrand = employerBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escapedBrand}.{0,40}\\b(?:is|operated by|run by|offered by)\\s+([A-Z][A-Za-z0-9&.,' -]{2,80})`, 'i'),
    new RegExp(`([A-Z][A-Za-z0-9&.,' -]{2,80})\\s+\\((?:the )?["']?${escapedBrand}["']?\\)`, 'i'),
    new RegExp(`([A-Z][A-Za-z0-9&.,' -]{2,80})\\s+(?:d\\/b\\/a|doing business as)\\s+${escapedBrand}`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = compactText.match(pattern);
    const candidate = cleanEntityName(match?.[1] || '');
    if (!candidate) continue;
    if (candidate.toLowerCase() === employerBrand.toLowerCase()) continue;
    if (!PARENT_SUFFIX_RE.test(candidate)) continue;
    return candidate;
  }

  return undefined;
}

function inferParentFromText(jobText: string, employerBrand: string): string | undefined {
  const compactText = jobText.replace(/\s+/g, ' ').trim();
  for (const pattern of RELATION_PATTERNS) {
    const match = compactText.match(pattern);
    const candidate = cleanEntityName(match?.[1] || '');
    if (!candidate) continue;
    if (candidate.toLowerCase() === employerBrand.toLowerCase()) continue;
    if (!PARENT_SUFFIX_RE.test(candidate)) continue;
    return candidate;
  }

  const brandEscaped = employerBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reversePattern = new RegExp(`${brandEscaped}.{0,80}(?:brand|division|subsidiary|platform).{0,20}(?:of|under|within|owned by|operated by)\\s+([A-Z][A-Za-z0-9&.,' -]{2,80})`, 'i');
  const reverseMatch = compactText.match(reversePattern);
  const reverseCandidate = cleanEntityName(reverseMatch?.[1] || '');
  if (reverseCandidate && reverseCandidate.toLowerCase() !== employerBrand.toLowerCase() && PARENT_SUFFIX_RE.test(reverseCandidate)) {
    return reverseCandidate;
  }

  return undefined;
}

function makeAliases(...values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => cleanEntityName(value || '')).filter(Boolean))];
}

export function resolveCompanyIdentity(companyName: string, jobText = '', jobUrl?: string): CompanyIdentity {
  const employerBrand = cleanEntityName(companyName) || companyName;
  const legalEntity = inferLegalEntityFromText(jobText, employerBrand);
  const parentCompany = inferParentFromText(jobText, employerBrand) || legalEntity;
  const officialDomain = inferBrandDomain(employerBrand, jobUrl);

  return {
    employerBrand,
    legalEntity,
    officialDomain,
    parentCompany,
    aliases: makeAliases(employerBrand, legalEntity, officialDomain),
    parentAliases: makeAliases(parentCompany, legalEntity),
    relationshipSummary: parentCompany
      ? `${employerBrand} appears to be the employer-facing brand, with ${parentCompany} as the parent/public company context.`
      : undefined,
  };
}
