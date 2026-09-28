-- X09 Docs database schema (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  pass_hash              TEXT NOT NULL,
  pass_salt              TEXT NOT NULL,
  display_name           TEXT,
  plan                   TEXT,                -- NULL (no active plan) | 'solo' | 'pro' | 'business'
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  sub_status             TEXT,
  current_period_end     INTEGER,
  created_at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- AI drafts used per calendar month
CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL,
  period  TEXT NOT NULL,          -- YYYY-MM (UTC)
  ai      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- The business shown on every document (one per account)
CREATE TABLE IF NOT EXISTS business (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data         TEXT NOT NULL,     -- JSON: name, email, phone, address, website, taxId, currency, taxRate, payment, terms, color
  logo         TEXT,              -- data: URL (small image)
  updated_at   INTEGER NOT NULL
);

-- Next document number per type
CREATE TABLE IF NOT EXISTS counters (
  user_id TEXT NOT NULL,
  type    TEXT NOT NULL,
  next    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS docs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,     -- invoice | estimate | proposal | contract
  number       TEXT NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | viewed | accepted | declined | paid | void
  client_name  TEXT,
  client_email TEXT,
  total        REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  data         TEXT NOT NULL,     -- JSON body: client, dates, items, sections, notes, terms, tax, discount
  share_id     TEXT NOT NULL UNIQUE,
  signer_name  TEXT,
  signed_at    INTEGER,
  sign_ip      TEXT,
  viewed_at    INTEGER,
  paid_at      INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON docs(user_id, updated_at DESC);

-- Small key/value settings (e.g. the Stripe Customer Portal configuration id)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
