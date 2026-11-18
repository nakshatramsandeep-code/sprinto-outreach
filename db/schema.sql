-- Sprinto outreach: four tables plus one counter table.

CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  domain        TEXT UNIQUE NOT NULL,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  reason        TEXT,
  rank          INT,
  flags         TEXT[] NOT NULL DEFAULT '{}',
  discovery     JSONB,
  fields        JSONB,
  contact       JSONB,
  loop_fetches  INT NOT NULL DEFAULT 0,
  tokens        INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  researched_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pages (
  url        TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  links      JSONB NOT NULL DEFAULT '[]',
  method     TEXT NOT NULL,
  word_count INT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS steps (
  id         SERIAL PRIMARY KEY,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  step       TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}',
  tokens     INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS steps_company_idx ON steps(company_id, id);

CREATE TABLE IF NOT EXISTS drafts (
  id            SERIAL PRIMARY KEY,
  company_id    INT UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  pains         JSONB NOT NULL DEFAULT '[]',
  hook_field    TEXT,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  validation    JSONB NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INT NOT NULL DEFAULT 0
);

-- ===== v2: scoring, versioned ICP, human checkpoints, audit log, candidates, outcomes =====

ALTER TABLE companies ADD COLUMN IF NOT EXISTS score INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS duration_ms INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS icp_version INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS extra_urls TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'first';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS original_body TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;
ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_company_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS drafts_company_kind_idx ON drafts(company_id, kind);

CREATE TABLE IF NOT EXISTS icp_versions (
  id         SERIAL PRIMARY KEY,
  version    INT UNIQUE NOT NULL,
  config     JSONB NOT NULL,
  note       TEXT,
  active     BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id          SERIAL PRIMARY KEY,
  company_id  INT REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'open',
  resolution  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS checkpoints_open_idx ON checkpoints(status, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id           SERIAL PRIMARY KEY,
  dkey         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  domain       TEXT,
  source       TEXT NOT NULL,
  signal       TEXT,
  url          TEXT,
  stage        TEXT,
  published_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'new',
  company_id   INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_events (
  id       SERIAL PRIMARY KEY,
  draft_id INT REFERENCES drafts(id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw      JSONB
);

UPDATE drafts SET original_body = body WHERE original_body IS NULL;
UPDATE companies SET score = rank WHERE score IS NULL AND rank IS NOT NULL;

-- ===== v3: eval harness + feedback loop =====

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS edit_diff JSONB;

CREATE TABLE IF NOT EXISTS eval_cases (
  id         SERIAL PRIMARY KEY,
  domain     TEXT UNIQUE NOT NULL,
  company_id INT,
  name       TEXT,
  pages      JSONB NOT NULL,
  expected   JSONB NOT NULL DEFAULT '{}',
  labeled_by TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  model       TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  icp_version INT,
  note        TEXT,
  metrics     JSONB NOT NULL,
  results     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_runs_kind_idx ON eval_runs(kind, id);
