-- Sub company data audit. READ-ONLY: every statement is a SELECT.
-- Run in the Supabase SQL editor, one block at a time. Nothing here changes data.
-- Each block lists rows that look inconsistent for multi-user sub companies.

-- 1. Sub portal users not linked to a company (they only see jobs assigned to them by email,
--    don't show up under the company, and don't count as teammates for billing history).
SELECT p.id, p.full_name, p.invite_email, p.role, p.company_name,
       (SELECT c.id FROM companies c WHERE lower(trim(c.name)) = lower(trim(p.company_name)) LIMIT 1) AS matching_company_id
FROM profiles p
WHERE p.role IN ('subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin')
  AND p.company_id IS NULL
ORDER BY p.company_name, p.full_name;

-- 2. Users whose company_name text disagrees with the company they're linked to.
SELECT p.id, p.full_name, p.invite_email, p.company_name AS profile_company_name, c.name AS linked_company
FROM profiles p JOIN companies c ON c.id = p.company_id
WHERE lower(trim(coalesce(p.company_name, ''))) <> lower(trim(c.name));

-- 3. Duplicate companies (same name, different ids). Merge with Admin → Merge companies.
SELECT lower(trim(name)) AS name_key, count(*) AS n, array_agg(id) AS ids, array_agg(name) AS names
FROM companies
GROUP BY 1 HAVING count(*) > 1;

-- 4a. Duplicate directory entries for one company.
SELECT lower(trim(company_name)) AS company_key, count(*) AS n,
       array_agg(contact_name) AS contacts, array_agg(email) AS emails, array_agg(status) AS statuses
FROM sub_directory
GROUP BY 1 HAVING count(*) > 1;

-- 4b. Same email in the directory more than once.
SELECT lower(trim(email)) AS email_key, count(*) AS n, array_agg(company_name) AS companies
FROM sub_directory WHERE email IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;

-- 5. Directory companies with no companies row (access/contacts can't be managed for them).
SELECT d.id, d.company_name, d.contact_name, d.email, d.status
FROM sub_directory d
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE lower(trim(c.name)) = lower(trim(d.company_name)));

-- 6. Assignments by email that were never linked to the user who has that email.
SELECT ja.id, ja.job_id, ja.sub_email, p.id AS profile_id, p.full_name
FROM job_assignments ja
JOIN profiles p ON lower(p.invite_email) = lower(ja.sub_email)
WHERE ja.sub_id IS NULL;

-- 7. Person assignments with no company_id although the person belongs to a company.
SELECT ja.id, ja.job_id, ja.sub_email, p.full_name, p.company_id
FROM job_assignments ja
JOIN profiles p ON p.id = ja.sub_id
WHERE ja.company_id IS NULL AND p.company_id IS NOT NULL;

-- 8. Assignment rows whose company_id disagrees with the person's company.
SELECT ja.id, ja.job_id, ja.sub_email, ja.company_id AS row_company, p.company_id AS person_company
FROM job_assignments ja JOIN profiles p ON p.id = ja.sub_id
WHERE ja.company_id IS NOT NULL AND p.company_id IS NOT NULL AND ja.company_id <> p.company_id;

-- 9. Duplicate assignment rows (same job + same email, or two company-level rows).
SELECT job_id, lower(sub_email) AS sub_email, count(*) AS n, array_agg(id) AS ids
FROM job_assignments WHERE sub_email IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1;
SELECT job_id, company_id, count(*) AS n, array_agg(id) AS ids
FROM job_assignments WHERE sub_id IS NULL AND sub_email IS NULL
GROUP BY 1, 2 HAVING count(*) > 1;

-- 10. Mixed billing switches for one company on one job (shows as "Billing partly on").
SELECT ja.job_id, coalesce(ja.company_id, p.company_id) AS company_id,
       count(*) FILTER (WHERE ja.billing_enabled) AS on_rows,
       count(*) FILTER (WHERE NOT ja.billing_enabled) AS off_rows
FROM job_assignments ja LEFT JOIN profiles p ON p.id = ja.sub_id
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE ja.billing_enabled) > 0 AND count(*) FILTER (WHERE NOT ja.billing_enabled) > 0;

-- 11. Subcontracts not linked to a company (only the linked user / vendor-name match can bill).
SELECT sc.id, sc.job_id, sc.vendor_name, sc.sub_id, sc.status,
       (SELECT c.id FROM companies c WHERE lower(trim(c.name)) = lower(trim(sc.vendor_name)) LIMIT 1) AS matching_company_id
FROM subcontracts sc
WHERE sc.company_id IS NULL;

-- 12. Subcontracts whose linked user belongs to a different company than the contract.
SELECT sc.id, sc.job_id, sc.vendor_name, sc.company_id AS contract_company, p.company_id AS user_company, p.full_name
FROM subcontracts sc JOIN profiles p ON p.id = sc.sub_id
WHERE sc.company_id IS NOT NULL AND p.company_id IS DISTINCT FROM sc.company_id;

-- 13. Profile email out of sync with the login email.
SELECT p.id, p.full_name, p.invite_email, u.email AS login_email
FROM profiles p JOIN auth.users u ON u.id = p.id
WHERE p.invite_email IS NOT NULL AND lower(p.invite_email) <> lower(u.email);

-- 14. Logins with no profile row (they can sign in but the portal can't place them).
SELECT u.id, u.email, u.created_at, u.raw_user_meta_data->>'company_name' AS meta_company
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id);

-- 15. Everything about one company (edit the pattern), e.g. J2.
SELECT 'company' AS kind, c.id::text, c.name, NULL AS email, NULL AS extra FROM companies c WHERE c.name ILIKE '%J2%'
UNION ALL
SELECT 'portal user', p.id::text, p.full_name, p.invite_email, concat(p.role, ' / company_id=', p.company_id) FROM profiles p WHERE p.company_name ILIKE '%J2%' OR p.company_id IN (SELECT id FROM companies WHERE name ILIKE '%J2%')
UNION ALL
SELECT 'directory', d.id::text, d.contact_name, d.email, d.status FROM sub_directory d WHERE d.company_name ILIKE '%J2%'
UNION ALL
SELECT 'assignment', ja.id::text, ja.job_id::text, ja.sub_email, concat('billing=', ja.billing_enabled, ' sub_id=', ja.sub_id) FROM job_assignments ja
  WHERE ja.company_id IN (SELECT id FROM companies WHERE name ILIKE '%J2%')
     OR ja.sub_id IN (SELECT p.id FROM profiles p WHERE p.company_name ILIKE '%J2%')
UNION ALL
SELECT 'subcontract', sc.id::text, sc.vendor_name, NULL, concat(sc.status, ' sub_id=', sc.sub_id, ' company_id=', sc.company_id) FROM subcontracts sc WHERE sc.vendor_name ILIKE '%J2%';
