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
