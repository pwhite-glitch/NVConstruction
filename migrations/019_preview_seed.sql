-- Migration 019: Seed staging data for role preview
-- Requires: migration 018 first.
-- These records are flagged is_preview_data = true and never appear in
-- production reports or billing. They exist only for role-preview testing.
--
-- Company A  (Acme Framing)       → Job 1, Job 2
-- Company B  (Precision Electric) → Job 2, Job 3
-- Sub from A can see Jobs 1+2; sub from B can see Jobs 2+3.
-- Jobs 1 and 3 verify company isolation.

BEGIN;

-- ── Two preview companies ─────────────────────────────────────────────────────
INSERT INTO companies (id, name, is_preview_data)
VALUES
  ('11111111-1111-4111-8111-111111111111', '[PREVIEW] Acme Framing Co.',       true),
  ('22222222-2222-4222-8222-222222222222', '[PREVIEW] Precision Electric LLC', true)
ON CONFLICT (id) DO UPDATE
  SET name           = EXCLUDED.name,
      is_preview_data = true;

-- ── Three preview jobs ────────────────────────────────────────────────────────
-- Adjust any additional NOT NULL columns your jobs table requires.
INSERT INTO jobs (id, job_number, project_name, status, billing_type, nv_role, job_type, is_preview_data)
VALUES
  ('33333333-3333-4333-8333-333333333301',
   'PREVIEW-001', '[PREVIEW] Medical Office Building',
   'active', 'aia', 'gc', 'commercial', true),
  ('33333333-3333-4333-8333-333333333302',
   'PREVIEW-002', '[PREVIEW] Retail Strip Center',
   'active', 'aia', 'gc', 'commercial', true),
  ('33333333-3333-4333-8333-333333333303',
   'PREVIEW-003', '[PREVIEW] Warehouse Renovation',
   'active', 'aia', 'gc', 'commercial', true)
ON CONFLICT (id) DO UPDATE
  SET job_number      = EXCLUDED.job_number,
      project_name    = EXCLUDED.project_name,
      is_preview_data = true;

-- ── Company ↔ job assignments ─────────────────────────────────────────────────
-- job_assignments(job_id, company_id, sub_email, sub_id, …)
-- sub_id is left null here; if your constraint requires it, set it to a
-- sentinel UUID or remove those rows and assign via a real sub profile.
INSERT INTO job_assignments (job_id, company_id, sub_email)
VALUES
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', null),  -- A → Job 1
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', null),  -- A → Job 2
  ('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222222', null),  -- B → Job 2
  ('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222222', null)   -- B → Job 3
ON CONFLICT DO NOTHING;

COMMIT;
