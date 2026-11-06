-- Migration 042: drawings read access, AIA app numbers, owner draw-request read.
--
-- NOT APPLIED. Review and run by hand. Safe to re-run (DROP ... IF EXISTS /
-- CREATE ... IF NOT EXISTS).
--
-- 1. drawings_select (002) is USING (true): every signed-in user (subs, client
--    owners, sales reps) can list every job's drawings and their storage_path.
--    Replaced with: office roles (is_office_user(): principal, pm, apm, super,
--    admin) plus subs who can see that job (sub_can_see_job, migration 027).
--    The drawings insert/delete policies (011) are unchanged. The job page no
--    longer UPDATEs drawings from the browser (supersede / restore now run in
--    /api/drawings with the service role), so no UPDATE policy is added.
--    PM/APM per-job limits stay in the API (lib/roles.js), as for other tables.
--
-- 2. aia_applications: app numbers unique per sequence.
--      prime / owner apps:  UNIQUE (job_id, app_number) WHERE nv_subcontract_id IS NULL
--      NV-sub apps:         UNIQUE (job_id, nv_subcontract_id, app_number) WHERE nv_subcontract_id IS NOT NULL
--    !! BLOCKER: the prime index FAILS on live data today. Job
--    8ae26b84-c4df-4a75-a466-48ee7bed9f0c (Module X Phase Concrete Pad #1247)
--    has two prime apps numbered 1:
--      891790d7... submitted, payment_received
--      b258ed4e... submitted, not paid
--    Decide which one is real (renumber or remove the other) before applying
--    section 2a. Nothing here changes data. The SRS #121 NV-sub apps both
--    numbered 1 are on different nv_subcontract_id values, so 2b is fine.
--    Pre-check:
--      SELECT job_id, app_number, count(*) FROM aia_applications
--      WHERE nv_subcontract_id IS NULL GROUP BY 1, 2 HAVING count(*) > 1;
--      SELECT job_id, nv_subcontract_id, app_number, count(*) FROM aia_applications
--      WHERE nv_subcontract_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
-- 3. draw_requests has RLS on and no policies (038), so the /owner portal Draw
--    Requests tab is always empty. Adds an owner SELECT policy modeled on
--    aia_applications_owner_select (038): role 'owner' AND the job's
--    owner_email is the caller's login email, and only non-draft statuses.
--    draw_requests are written with status 'open' / 'closed' by the app;
--    'submitted' / 'approved' are included in case older rows use them.
--    Office access to draw_requests stays service-role only (/api/draw-requests).
--    (draw_requests already has UNIQUE (job_id, draw_number) live as
--    draw_requests_job_id_draw_number_key; nothing added for that.)

BEGIN;

-- ── 1. drawings_select ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drawings_select" ON public.drawings;
CREATE POLICY "drawings_select" ON public.drawings FOR SELECT TO authenticated
  USING (
    (select public.is_office_user())
    OR (public.is_sub_user() AND public.sub_can_see_job(job_id))
  );

-- ── 2a. prime app numbers (see BLOCKER above) ────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS aia_applications_job_app_number_prime_key
  ON public.aia_applications (job_id, app_number)
  WHERE nv_subcontract_id IS NULL;

-- ── 2b. NV-sub app numbers ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS aia_applications_job_nvsub_app_number_key
  ON public.aia_applications (job_id, nv_subcontract_id, app_number)
  WHERE nv_subcontract_id IS NOT NULL;

-- ── 3. draw_requests owner read ─────────────────────────────────────────────
DROP POLICY IF EXISTS "draw_requests_owner_select" ON public.draw_requests;
CREATE POLICY "draw_requests_owner_select" ON public.draw_requests FOR SELECT TO authenticated
  USING (
    (select public.get_my_role()) = 'owner'
    AND status IN ('open', 'closed', 'submitted', 'approved')
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = draw_requests.job_id
        AND lower(j.owner_email) = lower((select auth.jwt() ->> 'email'))
    )
  );

COMMIT;
