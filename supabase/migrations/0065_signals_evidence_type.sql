-- Signals gain an evidence TYPE, so report tallies and the signals-export
-- corpus can stop counting a 25,000-worker field study the same as a product
-- announcement. Nullable, no default: an unclassified row stays honestly
-- null until the backfill script (or the pipeline proposer, going forward)
-- classifies it.
alter table signals add column if not exists evidence_type text
  check (evidence_type in (
    'experiment', 'statistics', 'survey', 'projection',
    'announcement', 'analysis', 'other'
  ));

comment on column signals.evidence_type is
  'What kind of evidence this signal is, not what it is about. '
  'experiment: a controlled or field study with measured outcomes. '
  'statistics: primary figures reported by the party that holds them (earnings, filings, official data). '
  'survey: self-reported polling of people or firms. '
  'projection: a forecast or consulting estimate. '
  'announcement: a launch, deal, policy or release with no measured outcome. '
  'analysis: commentary or a secondary synthesis. '
  'other: none of the above. '
  'Nullable with no default so an unclassified row stays honestly null.';
