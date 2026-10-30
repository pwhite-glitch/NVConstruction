-- Migration 036: Bot API access.
--
-- Three bot users ("Portal Bot (Peyton)", "(Nishil)", "(Vivek)") call a scoped
-- server API (/api/bot/v1) with their own API key instead of using the browser.
--
-- What this does:
--   1. profiles.is_bot (default false). Bot profiles are created by
--      scripts/create-bot-users.js (not here), with role 'pm' so the existing
--      office policies (is_office_user) let them read and write. Bots can't
--      sign in through /login, and /api routes (requireAuth) refuse them.
--   2. bot_api_keys: one row per issued key. Only a sha256 hash of the key is
--      stored, plus its first 8 characters for display. At most one
--      non-revoked key per bot (rotating revokes the old one first).
--      RLS on with NO policies, and all grants to anon / authenticated
--      revoked: only server routes (service role) touch this table.
-- Bot attachment uploads (as the bot, under RLS) use the existing
-- "authenticated can upload job-documents" storage policy; nothing changes there.
--
-- Runs in one transaction. Safe to re-run.
-- Rollback:
--   DROP TABLE IF EXISTS public.bot_api_keys;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_bot;

BEGIN;

-- ── PROFILES.IS_BOT ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- ── BOT_API_KEYS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_api_keys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         text,
  key_prefix    text        NOT NULL,                 -- first 8 chars, display only
  key_hash      text        NOT NULL,                 -- sha256 hex of the raw key
  enabled       boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,                          -- set when this key replaced an older one
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  CONSTRAINT bot_api_keys_hash_format CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_api_keys_key_hash_idx ON public.bot_api_keys (key_hash);
-- One live key per bot
CREATE UNIQUE INDEX IF NOT EXISTS bot_api_keys_one_live_per_bot_idx
  ON public.bot_api_keys (bot_user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.bot_api_keys ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. Also drop table grants so a future permissive
-- policy can't expose key hashes to the browser.
REVOKE ALL ON public.bot_api_keys FROM anon, authenticated;

COMMIT;
