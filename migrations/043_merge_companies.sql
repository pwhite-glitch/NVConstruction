-- Migration 043: merge_companies(p_keep, p_remove) — merge two sub companies in
-- one transaction (Directory "Merge Sub Accounts", /api/merge-companies).
--
-- NOT APPLIED. Write-only in this pass; apply in a later pass after review.
-- (042_drawings_aia_numbers_owner_draws.sql is also still unapplied.)
--
-- What it does, all-or-nothing:
--   1. Checks p_keep <> p_remove and both companies exist (locks both rows).
--   2. Moves company_contacts from remove -> keep. A contact whose email already
--      exists on keep (company_contacts_company_email_uniq is
--      (company_id, lower(email)) WHERE email IS NOT NULL) is deleted instead of
--      moved, and counted as contacts_skipped_dup_email.
--   3. profiles.company_id / company_name and subcontracts.company_id -> keep.
--   4. job_assignments: a COMPANY-LEVEL row on remove (sub_id null and sub_email
--      null/empty) whose job already has a company-level row on keep is folded:
--      keep.billing_enabled := keep OR remove (true wins), then the remove row is
--      deleted. Every other remove row (including person-level rows with
--      sub_id / sub_email set) is re-pointed to keep. There is no UNIQUE on
--      (job_id, company_id), so without the fold a merge could leave two
--      company-level rows on one job.
--   5. Deletes the remove company row.
--   6. Returns jsonb: profiles_moved, contacts_moved, contacts_skipped_dup_email,
--      assignments_moved, assignments_folded, contracts_moved, kept_name.
--
-- Callable by the service role only (the API route checks the caller is an Owner).

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_companies(p_keep uuid, p_remove uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep_name        text;
  v_remove_found     boolean;
  v_profiles         int := 0;
  v_contacts_moved   int := 0;
  v_contacts_skipped int := 0;
  v_assign_moved     int := 0;
  v_assign_folded    int := 0;
  v_contracts        int := 0;
  r                  record;
  v_keep_row         uuid;
BEGIN
  IF p_keep IS NULL OR p_remove IS NULL THEN
    RAISE EXCEPTION 'keep and remove company ids are required';
  END IF;
  IF p_keep = p_remove THEN
    RAISE EXCEPTION 'Cannot merge a company with itself';
  END IF;

  SELECT name INTO v_keep_name FROM companies WHERE id = p_keep FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keep company not found';
  END IF;
  PERFORM 1 FROM companies WHERE id = p_remove FOR UPDATE;
  v_remove_found := FOUND;
  IF NOT v_remove_found THEN
    RAISE EXCEPTION 'Company to remove not found';
  END IF;

  -- 2. Contacts (drop the ones whose email keep already has)
  DELETE FROM company_contacts c
   WHERE c.company_id = p_remove
     AND c.email IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM company_contacts k
        WHERE k.company_id = p_keep
          AND k.email IS NOT NULL
          AND lower(k.email) = lower(c.email)
     );
  GET DIAGNOSTICS v_contacts_skipped = ROW_COUNT;

  UPDATE company_contacts SET company_id = p_keep WHERE company_id = p_remove;
  GET DIAGNOSTICS v_contacts_moved = ROW_COUNT;

  -- 3. People and contracts
  UPDATE profiles SET company_id = p_keep, company_name = v_keep_name WHERE company_id = p_remove;
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  UPDATE subcontracts SET company_id = p_keep WHERE company_id = p_remove;
  GET DIAGNOSTICS v_contracts = ROW_COUNT;

  -- 4. Job assignments: fold duplicate company-level rows, move the rest
  FOR r IN
    SELECT id, job_id, billing_enabled
      FROM job_assignments
     WHERE company_id = p_remove
       AND sub_id IS NULL
       AND coalesce(sub_email, '') = ''
     FOR UPDATE
  LOOP
    SELECT id INTO v_keep_row
      FROM job_assignments
     WHERE company_id = p_keep
       AND job_id = r.job_id
       AND sub_id IS NULL
       AND coalesce(sub_email, '') = ''
     ORDER BY invited_at NULLS LAST, id
     LIMIT 1
     FOR UPDATE;

    IF v_keep_row IS NOT NULL THEN
      UPDATE job_assignments
         SET billing_enabled = coalesce(billing_enabled, false) OR coalesce(r.billing_enabled, false)
       WHERE id = v_keep_row;
      DELETE FROM job_assignments WHERE id = r.id;
      v_assign_folded := v_assign_folded + 1;
    END IF;
  END LOOP;

  -- Remaining remove rows: company-level rows with no keep twin, and person-level rows
  UPDATE job_assignments SET company_id = p_keep WHERE company_id = p_remove;
  GET DIAGNOSTICS v_assign_moved = ROW_COUNT;

  -- 5. Company row (anything still pointing at it with ON DELETE CASCADE was moved above)
  DELETE FROM companies WHERE id = p_remove;

  RETURN jsonb_build_object(
    'profiles_moved',             v_profiles,
    'contacts_moved',             v_contacts_moved,
    'contacts_skipped_dup_email', v_contacts_skipped,
    'assignments_moved',          v_assign_moved,
    'assignments_folded',         v_assign_folded,
    'contracts_moved',            v_contracts,
    'kept_name',                  v_keep_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_companies(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_companies(uuid, uuid) TO service_role;

COMMIT;
