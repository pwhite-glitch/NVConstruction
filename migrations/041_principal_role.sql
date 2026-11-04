-- Migration 041: new staff role 'principal' (UI label "Owner").
--
-- 'principal' = company owners/partners. They see and act on every job, with no
-- assignment needed: everything a PM can do, plus the owner-only items
-- (permissions, employees, labor, estimator editing, ...).
-- NOT the same as 'owner', which is the CLIENT / building owner (/owner portal,
-- jobs_owner_select, aia_applications_owner_select). Client-owner policies are
-- left exactly as they are.
--
-- What this does (safe to re-run):
--   1. profiles_role_check: adds 'principal', and 'owner' so the existing client
--      portal role can be assigned. Every current value is kept.
--   2. is_office_user(): adds 'principal'. Every policy built on it (jobs,
--      subcontracts, billing, direct_costs, aia_*, ...) then covers principals.
--   3. Every RLS policy (schemas public + storage) whose USING / WITH CHECK names
--      the 'pm' role literal gets 'principal' next to it, with the same meaning
--      otherwise. It is done in place with ALTER POLICY, so name, command, roles
--      and permissive/restrictive stay the same. Each change is printed with
--      RAISE NOTICE (old and new text). Policies that already mention 'principal'
--      are skipped, which makes a re-run a no-op.
--      Set dry_run := true below to see the changes without applying them.
--   4. Lists, without changing, any other function whose body has a 'pm' literal.
--
-- No data changes: no profile is updated here. Moving the three partners to
-- 'principal' is a separate step.
--
-- NOTE: this does NOT add per-job limits to RLS. PM/APM limits are enforced in
-- the API routes and UI (lib/roles.js). RLS still lets any office user read
-- every job from the browser.

BEGIN;

-- ── 1. Role constraint ───────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'principal', 'pm', 'apm', 'super', 'admin',
    'subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin',
    'roofing_rep', 'metal_rep',
    'owner'
  ));

-- ── 2. is_office_user() ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_office_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(public.get_my_role() IN ('principal', 'pm', 'apm', 'super', 'admin'), false)
$$;

-- ── 3. Policies with a 'pm' role literal ─────────────────────────────────────
DO $migration$
DECLARE
  dry_run   boolean := false;   -- true = only print what would change
  pol       record;
  new_qual  text;
  new_check text;
  stmt      text;
  changed   int := 0;
  skipped   int := 0;

  -- Adds 'principal' wherever the 'pm' literal is compared against.
  --   ARRAY['pm'::text, 'apm'::text]   -> ARRAY['pm'::text, 'principal'::text, 'apm'::text]
  --   x = 'pm'::text                   -> x = ANY (ARRAY['pm'::text, 'principal'::text])
  -- Casts (::text, ::character varying, ...) are kept.
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND (coalesce(qual, '') ~ '''pm''' OR coalesce(with_check, '') ~ '''pm''')
    ORDER BY schemaname, tablename, policyname
  LOOP
    -- Idempotent: already done
    IF coalesce(pol.qual, '') ~ '''principal''' OR coalesce(pol.with_check, '') ~ '''principal''' THEN
      skipped := skipped + 1;
      RAISE NOTICE 'skip (already has principal): %.% / %', pol.schemaname, pol.tablename, pol.policyname;
      CONTINUE;
    END IF;
    -- A negative test (<> 'pm', NOT IN) would change meaning if widened: leave for a human.
    IF (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ '(<>|!=)\s*(ALL\s*\(\s*\(?\s*ARRAY\[[^\]]*)?''pm''' THEN
      skipped := skipped + 1;
      RAISE WARNING 'NOT CHANGED (negative pm test, review by hand): %.% / %  USING: %  CHECK: %',
        pol.schemaname, pol.tablename, pol.policyname, pol.qual, pol.with_check;
      CONTINUE;
    END IF;

    new_qual  := pol.qual;
    new_check := pol.with_check;
    IF new_qual IS NOT NULL THEN
      -- inside ARRAY[...] lists (after '[' or ',')
      new_qual := regexp_replace(new_qual, '([\[,]\s*)''pm''((::[a-z ]+)?)', '\1''pm''\2, ''principal''\2', 'g');
      -- scalar equality
      new_qual := regexp_replace(new_qual, '=\s*''pm''((::[a-z ]+)?)(?!\s*,)', '= ANY (ARRAY[''pm''\1, ''principal''\1])', 'g');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, '([\[,]\s*)''pm''((::[a-z ]+)?)', '\1''pm''\2, ''principal''\2', 'g');
      new_check := regexp_replace(new_check, '=\s*''pm''((::[a-z ]+)?)(?!\s*,)', '= ANY (ARRAY[''pm''\1, ''principal''\1])', 'g');
    END IF;

    IF new_qual IS NOT DISTINCT FROM pol.qual AND new_check IS NOT DISTINCT FROM pol.with_check THEN
      skipped := skipped + 1;
      RAISE WARNING 'NOT CHANGED (pm literal in an unrecognised form, review by hand): %.% / %  USING: %  CHECK: %',
        pol.schemaname, pol.tablename, pol.policyname, pol.qual, pol.with_check;
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    IF new_qual IS NOT NULL THEN stmt := stmt || format(' USING (%s)', new_qual); END IF;
    IF new_check IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', new_check); END IF;

    RAISE NOTICE E'% %.% / % (%)\n  USING  old: %\n  USING  new: %\n  CHECK  old: %\n  CHECK  new: %',
      CASE WHEN dry_run THEN 'WOULD CHANGE' ELSE 'CHANGED' END,
      pol.schemaname, pol.tablename, pol.policyname, pol.cmd,
      pol.qual, new_qual, pol.with_check, new_check;

    IF NOT dry_run THEN
      BEGIN
        EXECUTE stmt;
      EXCEPTION WHEN insufficient_privilege THEN
        -- e.g. storage.objects is owned by supabase_storage_admin
        RAISE WARNING 'NOT CHANGED (no privilege, run as the table owner): %', stmt;
        skipped := skipped + 1;
        CONTINUE;
      END;
    END IF;
    changed := changed + 1;
  END LOOP;

  RAISE NOTICE '041 policies: % %, % skipped', changed, CASE WHEN dry_run THEN 'would change' ELSE 'changed' END, skipped;
END
$migration$;

-- ── 4. Report other functions that hard-code 'pm' (no change) ────────────────
DO $report$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ '''pm'''
      AND p.proname <> 'is_office_user'
  LOOP
    RAISE WARNING 'function %.% has a ''pm'' literal and was NOT changed; check whether principal needs adding', f.nspname, f.proname;
  END LOOP;
END
$report$;

COMMIT;
