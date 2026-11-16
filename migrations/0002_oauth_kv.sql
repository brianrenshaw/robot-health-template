-- 0002_oauth_kv.sql
-- Key-value storage for the chatbot Worker's OAuth sign-in (@cloudflare/workers-oauth-provider).
-- The library expects a Workers KV namespace; packages/core/src/kv.ts gives it this table instead,
-- so everything stays in one database. Tokens and codes are stored only as hashes by the library.
-- expires_at is Unix seconds; NULL means no expiry.

CREATE TABLE oauth_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT,
  expires_at INTEGER
);

CREATE INDEX idx_oauth_kv_expires ON oauth_kv(expires_at);
