-- Migration 020: Estimate-to-job link, RFI table for bid packages
-- Run after migration 019.

-- ── Link estimates to the job they became ─────────────────────────────────────
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS estimates_job_id ON estimates(job_id) WHERE job_id IS NOT NULL;

-- ── Track which job was converted from which bid package ──────────────────────
-- (bid_packages already has job_id; add source tracking to jobs)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_estimate_id uuid REFERENCES estimates(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_bid_id      uuid REFERENCES bid_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS jobs_source_estimate ON jobs(source_estimate_id) WHERE source_estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_source_bid      ON jobs(source_bid_id)      WHERE source_bid_id IS NOT NULL;

-- ── RFI log for bid packages ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bid_rfis (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_package_id   uuid        NOT NULL REFERENCES bid_packages(id) ON DELETE CASCADE,
  rfi_number       integer     NOT NULL DEFAULT 1,  -- auto-set by trigger or app
  subject          text        NOT NULL,
  question         text        NOT NULL,
  status           text        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','open','answered','closed')),
  responsible_party text,
  recipient_email  text,
  drawing_ref      text,       -- sheet/revision reference
  answer           text,
  scope_impact     text,       -- narrative of scope change if any
  cost_impact      numeric,    -- $ amount, positive or negative, null if none
  submitted_at     timestamptz,
  answered_at      timestamptz,
  closed_at        timestamptz,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bid_rfis_package ON bid_rfis(bid_package_id);

-- Unique RFI number per package
CREATE UNIQUE INDEX IF NOT EXISTS bid_rfis_number_per_pkg
  ON bid_rfis(bid_package_id, rfi_number);

ALTER TABLE bid_rfis ENABLE ROW LEVEL SECURITY;

-- Authenticated users with access to the bid package can see its RFIs
-- (Simplified: same visibility as bid_packages; tighten via allowed_users if needed)
CREATE POLICY "bid_rfis_select" ON bid_rfis FOR SELECT TO authenticated USING (true);
CREATE POLICY "bid_rfis_insert" ON bid_rfis FOR INSERT TO authenticated WITH CHECK (get_my_role() IN ('pm','apm','admin','super'));
CREATE POLICY "bid_rfis_update" ON bid_rfis FOR UPDATE TO authenticated USING (get_my_role() IN ('pm','apm','admin','super'));
CREATE POLICY "bid_rfis_delete" ON bid_rfis FOR DELETE TO authenticated USING (get_my_role() IN ('pm','admin'));
