-- Bot API audit (migration 036). READ-ONLY: every statement is a SELECT.
-- Run in the Supabase SQL editor, one block at a time. Nothing here changes data.

-- 1. Before 036: these must NOT exist yet (or match 036 exactly).
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'profiles' AND column_name = 'is_bot') OR table_name = 'bot_api_keys');

-- 2. Tables the Bot API reads/writes as an office user (role 'pm'). Each
--    should show an office (is_office_user / pm) policy for the listed command,
--    or the matching bot endpoint will return an RLS error.
--      SELECT: jobs, budget_items, subcontracts, subcontract_sov_lines,
--              change_orders, prime_change_orders, billing_submissions,
--              companies, profiles, job_assignments, job_documents
--      INSERT: subcontracts, billing_submissions, job_assignments,
--              job_documents, change_log
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('jobs', 'budget_items', 'subcontracts', 'subcontract_sov_lines', 'change_orders',
                    'prime_change_orders', 'billing_submissions', 'companies', 'profiles',
                    'job_assignments', 'job_documents', 'change_log')
ORDER BY tablename, cmd, policyname;

-- 3. Storage policies on the job-documents bucket. Bot uploads rely on the
--    existing "authenticated can upload job-documents" INSERT policy.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual, '') ILIKE '%job-documents%' OR coalesce(with_check, '') ILIKE '%job-documents%'
       OR policyname ILIKE '%job%doc%')
ORDER BY cmd, policyname;

-- 4. After 036 + scripts/create-bot-users.js: expect 3 rows, role pm, is_bot true.
SELECT p.id, p.full_name, p.role, p.is_bot, u.email, u.email_confirmed_at IS NOT NULL AS confirmed
FROM public.profiles p JOIN auth.users u ON u.id = p.id
WHERE p.is_bot OR u.email ILIKE '%@bots.nv.construction'
ORDER BY p.full_name;

-- 5. Keys (never shows hashes). At most one non-revoked row per bot.
SELECT k.id, p.full_name, k.key_prefix, k.enabled, k.created_at, k.rotated_at, k.last_used_at, k.revoked_at
FROM public.bot_api_keys k LEFT JOIN public.profiles p ON p.id = k.bot_user_id
ORDER BY p.full_name, k.created_at DESC;

-- 6. Recent bot changes in history.
SELECT created_at, changed_by_name, entity_type, field_name, new_value, note
FROM public.change_log
WHERE note ILIKE '%via Bot API%'
ORDER BY created_at DESC
LIMIT 50;
