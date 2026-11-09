-- Migration 060: rate limit for the public "Forgot password" route.
--
-- STATUS: PROPOSED — written, NOT applied. Apply only after Peyton okays it by name.
-- Does not edit any other migration. No data changes. Idempotent (safe to run twice).
--
-- Why: POST /api/reset-password is public and calls auth.admin.generateLink on every
-- request. The admin API skips Supabase's own per-address reset throttle and every call
-- mints a new recovery token (the previously emailed link stops working), so anyone could
-- spam a person's inbox or keep invalidating their reset link.
--
-- What this adds:
--   public.auth_rate_limits (bucket, key_hash, window_start, hits)
--     One row per (bucket, hashed key, fixed time window). key_hash is a SHA-256 hex of the
--     normalized email or the client IP — the raw email / IP is never stored.
--     RLS enabled with NO policies; anon/authenticated have no grants (service role only).
--   public.auth_rate_limit_hit(p_bucket text, p_key_hash text, p_window_seconds int, p_limit int)
--     RETURNS jsonb {"allowed": hits <= p_limit, "hits": n}
--     Atomically adds one hit to the current window's row (INSERT … ON CONFLICT DO UPDATE)
--     and opportunistically deletes rows older than 1 day.
--     SECURITY DEFINER, search_path = public. Execute: service_role only.
--
-- Code that uses it: lib/reset-rate-limit.js (checkResetLimits), called from
-- app/api/reset-password/route.js. Until this is applied the RPC is missing (PGRST202) and
-- the route falls back to an in-memory per-instance limiter with the same limits.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.auth_rate_limit_hit(text, text, int, int);
--   DROP TABLE IF EXISTS public.auth_rate_limits;

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket       text        NOT NULL,
  key_hash     text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int         NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_window_start_idx
  ON public.auth_rate_limits (window_start);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (which bypasses RLS) may touch it.
REVOKE ALL ON TABLE public.auth_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.auth_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.auth_rate_limit_hit(
  p_bucket text,
  p_key_hash text,
  p_window_seconds int,
  p_limit int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_hits int;
BEGIN
  IF p_bucket IS NULL OR p_key_hash IS NULL OR p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_limit IS NULL THEN
    RAISE EXCEPTION 'auth_rate_limit_hit_bad_args';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.auth_rate_limits AS t (bucket, key_hash, window_start, hits)
  VALUES (p_bucket, p_key_hash, v_window_start, 1)
  ON CONFLICT (bucket, key_hash, window_start)
  DO UPDATE SET hits = t.hits + 1
  RETURNING t.hits INTO v_hits;

  -- Opportunistic cleanup (longest window used is 1 day).
  DELETE FROM public.auth_rate_limits WHERE window_start < now() - interval '1 day';

  RETURN jsonb_build_object('allowed', v_hits <= p_limit, 'hits', v_hits);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_rate_limit_hit(text, text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_rate_limit_hit(text, text, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_rate_limit_hit(text, text, int, int) TO service_role;
