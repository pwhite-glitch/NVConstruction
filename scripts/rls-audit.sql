-- RLS / access audit. READ-ONLY: every statement is a SELECT.
-- Run in the Supabase SQL editor, one block at a time. Nothing here changes data.

-- 0a. Pre-flight for 028/029: functions they CREATE OR REPLACE. Each must be
--     missing, or have these args/return types (otherwise that migration
--     fails and rolls back): get_my_role() text · is_office_user() boolean ·
--     is_sub_user() boolean · my_company_id() uuid · is_company_teammate(uuid)
--     boolean · protect_profile_access_columns() trigger · handle_new_user()
--     trigger · handle_user_email_confirmed() trigger ·
--     link_job_assignments_by_email(uuid, text) void. sub_can_see_job(uuid)
--     boolean must exist (027).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_my_role', 'is_office_user', 'is_sub_user', 'my_company_id', 'is_company_teammate',
                    'protect_profile_access_columns', 'handle_new_user', 'handle_user_email_confirmed',
                    'link_job_assignments_by_email', 'sub_can_see_job')
ORDER BY p.proname;

-- 0b. Pre-flight: columns 028 policies reference. Expect 11 rows.
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name, column_name) IN (
  ('jobs', 'owner_email'), ('profiles', 'invite_email'), ('profiles', 'job_access'), ('profiles', 'can_bill'),
  ('profiles', 'company_id'), ('subcontracts', 'status'), ('subcontracts', 'company_id'), ('subcontracts', 'sub_id'),
  ('job_assignments', 'sub_email'), ('job_assignments', 'company_id'), ('billing_submissions', 'sub_id'))
ORDER BY 1, 2;

-- 0c. Existing triggers on profiles (028 adds protect_profile_access_columns).
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;

-- 0d. Is "Confirm email" on? If self-signups are confirmed the instant they
--     are created, Supabase is auto-confirming: anyone can register with any
--     address (including an invited sub's), and email-based job matching
--     trusts it. Turn on Auth → Providers → Email → "Confirm email".
SELECT count(*) FILTER (WHERE u.email_confirmed_at - u.created_at < interval '5 seconds') AS confirmed_instantly,
       count(*) AS self_signups
FROM auth.users u
WHERE u.invited_at IS NULL AND u.created_at > now() - interval '180 days';

-- 1. BEFORE migration 028: every policy it will drop. Save this output; it is
--    the rollback reference.
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('jobs', 'subcontracts', 'job_assignments', 'billing_submissions', 'profiles', 'companies')
ORDER BY tablename, cmd, policyname;

-- 2. Wide-open policies on ANY public table: a permissive policy for
--    authenticated / public / anon whose USING or WITH CHECK is "true" or
--    missing, or only checks that the caller is signed in. Because policies OR
--    together, one of these opens the whole table to every sub and owner.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'PERMISSIVE'
  AND (roles && ARRAY['authenticated', 'public', 'anon']::name[])
  AND (
       (cmd IN ('SELECT', 'DELETE', 'UPDATE', 'ALL') AND (qual IS NULL OR qual = 'true' OR qual ILIKE '%auth.role()%authenticated%'))
    OR (cmd IN ('INSERT', 'UPDATE', 'ALL') AND (with_check IS NULL OR with_check = 'true' OR with_check ILIKE '%auth.role()%authenticated%'))
  )
ORDER BY tablename, cmd, policyname;

-- 3. Public tables with RLS switched OFF (readable and writable by anyone with
--    the anon key, which ships in the browser bundle).
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;

-- 4. Triggers on auth.users, with their function source. If one copies
--    raw_user_meta_data ->> 'role' into profiles.role, anyone can sign up with
--    role 'admin' (the signUp() metadata is chosen by the browser).
SELECT t.tgname, p.proname, pg_get_functiondef(p.oid) AS source
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal;

-- 5. Sub users whose invite_email differs from their login email. Before 028 a
--    sub could change invite_email themselves and see jobs assigned to that
--    address. Check each row is expected.
SELECT p.id, p.full_name, p.role, p.invite_email, u.email AS login_email, p.company_name
FROM profiles p JOIN auth.users u ON u.id = p.id
WHERE p.role IN ('subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin')
  AND p.invite_email IS NOT NULL
  AND lower(trim(p.invite_email)) <> lower(trim(u.email));

-- 6. Office-role profiles. Confirm every one of these is a real staff member
--    (anyone who self-escalated before RLS was locked would show up here).
SELECT p.id, p.full_name, p.role, u.email, u.created_at
FROM profiles p JOIN auth.users u ON u.id = p.id
WHERE p.role IN ('pm', 'apm', 'super', 'admin')
ORDER BY u.created_at DESC;

-- 7. Subcontracts that were auto-claimed by /api/link-sub-contracts (removed):
--    the linked user's company differs from the contract's company, or the
--    user has no company. Review and correct in the job's Companies tab.
SELECT sc.id, sc.job_id, sc.vendor_name, sc.company_id AS contract_company,
       p.id AS linked_user, p.full_name, p.company_id AS user_company, p.company_name AS user_company_name
FROM subcontracts sc JOIN profiles p ON p.id = sc.sub_id
WHERE sc.company_id IS DISTINCT FROM p.company_id;

-- 8. Non-draft subcontracts with no company and no user. Subs now only bill
--    against these by vendor-name match on jobs they already see, using the
--    company's own name. Link them with Directory → "Repair company links".
SELECT sc.id, sc.job_id, sc.vendor_name, sc.status
FROM subcontracts sc
WHERE sc.company_id IS NULL AND sc.sub_id IS NULL
  AND (sc.status IS NULL OR sc.status <> 'draft')
ORDER BY sc.vendor_name;

-- 9. Storage policies (buckets: documents, bid-plans, billing-docs, receipts,
--    bid-docs, daily-report-photos, sales-docs). Look for "true" / bucket-only checks.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 10. AFTER migration 028: the policies now on the six tables. Expect only the
--     *_office_*, *_sub_*, jobs_owner_select and profiles_*_own policies.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('jobs', 'subcontracts', 'job_assignments', 'billing_submissions', 'profiles', 'companies')
ORDER BY tablename, cmd, policyname;
