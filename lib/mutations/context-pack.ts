import { exec } from '../db';

// The Briefcase's one stored piece (mig 0080): the weekly model-written
// brief of one pack section. The caller (lib/context-pack/briefs.ts) has
// already run the gate; a brief reaches here with at least one surviving
// source link. One row per company, week and section: a rerun replaces it.
export async function saveContextPackBrief(input: {
  companySlug: string;
  weekEnd: string;
  sectionId: string;
  body: string;
  citeUrls: string[];
  dropped: string[];
  model: string;
}): Promise<void> {
  await exec(
    `insert into context_pack_briefs (company_slug, week_end, section_id, body, cite_urls, dropped, model)
     values ($1, $2::date, $3, $4, $5, $6, $7)
     on conflict (company_slug, week_end, section_id)
     do update set body = excluded.body, cite_urls = excluded.cite_urls, dropped = excluded.dropped,
                   model = excluded.model, created_at = now()`,
    [input.companySlug, input.weekEnd, input.sectionId, input.body, input.citeUrls, input.dropped.slice(0, 20), input.model]
  );
}
