-- Run this in your Supabase SQL editor BEFORE running scripts/load-lca.mjs

create table if not exists lca_data (
  id             bigserial primary key,
  employer_name  text not null,
  job_title      text,
  soc_code       text,
  soc_title      text,
  wage_from      numeric,
  wage_to        numeric,
  wage_unit      text,
  annual_wage_from numeric,
  annual_wage_to   numeric,
  city           text,
  state          text,
  decision_date  date,
  fiscal_year    text,
  -- unique constraint to allow safe re-runs / upserts
  unique (employer_name, job_title, decision_date, city, state)
);

-- Indexes for fast company name lookups (case-insensitive)
create index if not exists lca_employer_lower_idx on lca_data (lower(employer_name));
create index if not exists lca_soc_idx           on lca_data (soc_code);
create index if not exists lca_state_idx         on lca_data (state);
create index if not exists lca_date_idx          on lca_data (decision_date desc);
