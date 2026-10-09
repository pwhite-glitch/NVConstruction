-- Migration 023: Sales & Orders workspace
-- Adds unified sales_orders table for metal buildings and commercial roofing,
-- plus supporting tables for documents, tasks, updates, customer portal access,
-- and signature request tracking.
-- Safe to run on existing database — no existing tables modified.

-- ─── Core orders table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_orders (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),

  -- Identity
  order_number              text        UNIQUE NOT NULL,  -- e.g. MB-2026-001, RF-2026-001
  division                  text        NOT NULL CHECK (division IN ('metal_buildings', 'commercial_roofing')),

  -- Workflow stage
  stage                     text        NOT NULL DEFAULT 'lead'
                              CHECK (stage IN ('lead','quoted','contract_signed','order_placed','scheduled','installed','completed','cancelled','on_hold')),

  -- Customer information
  customer_name             text,
  customer_company          text,
  customer_email            text,
  customer_phone            text,

  -- Site
  site_address              text,
  city                      text,
  state                     text,
  zip                       text,

  -- Assignments
  salesperson_id            uuid        REFERENCES auth.users(id),
  salesperson_name          text,
  ops_owner_id              uuid        REFERENCES auth.users(id),
  ops_owner_name            text,

  -- Scope (shared)
  scope_description         text,
  exclusions                text,
  products                  jsonb       DEFAULT '[]'::jsonb,  -- [{name,qty,unit,unit_price,description}]
  options                   jsonb       DEFAULT '[]'::jsonb,  -- [{name,included,notes}]

  -- Metal buildings specific
  width_ft                  numeric,
  length_ft                 numeric,
  height_ft                 numeric,
  building_use              text,
  supplier_id               uuid        REFERENCES mb_suppliers(id),
  supplier_ref              text,       -- supplier's order/PO number

  -- Commercial roofing specific
  roof_type                 text,
  roof_size_sqft            numeric,
  building_type             text,

  -- Financials (internal — enforce access in application layer)
  quoted_amount             numeric,
  contract_value            numeric,
  internal_cost             numeric,
  estimated_profit          numeric,
  deposit_amount            numeric,
  deposit_received          boolean     DEFAULT false,
  deposit_received_date     date,

  -- Contract tracking
  contract_signed_at        timestamptz,
  contract_signed_by        text,

  -- Supplier order
  supplier_order_placed_at  timestamptz,
  supplier_order_confirmation text,

  -- Delivery
  expected_delivery_date    date,
  confirmed_delivery_date   date,
  delivery_notes            text,

  -- Installation
  expected_install_date     date,
  confirmed_install_date    date,
  install_notes             text,
  install_crew              text,

  -- Completion / status
  completed_at              timestamptz,
  won_at                    timestamptz,
  cancelled_at              timestamptz,
  cancelled_reason          text,

  -- Internal notes (never exposed to customers)
  internal_notes            text,

  -- Links to other records
  source_lead_id            uuid,       -- FK to metal_building_leads or roofing_leads (no FK constraint — two possible tables)
  linked_job_id             uuid        REFERENCES jobs(id),

  -- Data management
  is_preview_data           boolean     DEFAULT false
);

CREATE INDEX IF NOT EXISTS sales_orders_division_idx  ON sales_orders(division);
CREATE INDEX IF NOT EXISTS sales_orders_stage_idx     ON sales_orders(stage);
CREATE INDEX IF NOT EXISTS sales_orders_salesperson_idx ON sales_orders(salesperson_id);
CREATE INDEX IF NOT EXISTS sales_orders_created_idx   ON sales_orders(created_at DESC);

-- ─── Documents ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_order_docs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  order_id            uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  file_name           text        NOT NULL,
  storage_path        text        NOT NULL,      -- path in 'sales-docs' Supabase bucket
  category            text        DEFAULT 'general'
                        CHECK (category IN ('contract','quote','photo','permit','completion','other','general')),
  visible_to_customer boolean     DEFAULT false,
  uploaded_by         uuid        REFERENCES auth.users(id),
  uploaded_by_name    text,
  version_number      int         DEFAULT 1,
  replaces_doc_id     uuid        REFERENCES sales_order_docs(id),
  notes               text,
  file_size_bytes     bigint
);

CREATE INDEX IF NOT EXISTS sales_order_docs_order_idx ON sales_order_docs(order_id);

-- ─── Tasks ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_order_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  order_id        uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  description     text,
  assignee_id     uuid        REFERENCES auth.users(id),
  assignee_name   text,
  due_date        date,
  status          text        DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','done','cancelled')),
  priority        text        DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high')),
  created_by      uuid        REFERENCES auth.users(id),
  created_by_name text,
  completed_at    timestamptz,
  order_number    text        -- denormalized for My Work queue queries
);

CREATE INDEX IF NOT EXISTS sales_tasks_order_idx    ON sales_order_tasks(order_id);
CREATE INDEX IF NOT EXISTS sales_tasks_assignee_idx ON sales_order_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS sales_tasks_status_idx   ON sales_order_tasks(status) WHERE status != 'done';

-- ─── Customer-visible + internal updates ────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_order_updates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  order_id            uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  author_id           uuid        REFERENCES auth.users(id),
  author_name         text        NOT NULL,
  body                text        NOT NULL,
  visible_to_customer boolean     DEFAULT false,
  update_type         text        DEFAULT 'note'
                        CHECK (update_type IN ('note','status_change','document','email_sent','question'))
);

CREATE INDEX IF NOT EXISTS sales_updates_order_idx ON sales_order_updates(order_id);

-- ─── Activity history (audit log) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_order_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz DEFAULT now(),
  order_id    uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  actor_id    uuid        REFERENCES auth.users(id),
  actor_name  text,
  action      text        NOT NULL,  -- e.g. 'stage_change', 'field_update', 'doc_upload', 'task_complete'
  details     jsonb       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS sales_history_order_idx ON sales_order_history(order_id);

-- ─── Customer portal access tokens ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_portal_access (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  order_id         uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  email            text        NOT NULL,
  name             text,
  access_token     text        UNIQUE NOT NULL,  -- 64-char hex, generated in application
  invited_at       timestamptz DEFAULT now(),
  last_accessed_at timestamptz,
  revoked_at       timestamptz,
  invited_by       uuid        REFERENCES auth.users(id),
  invited_by_name  text
);

CREATE INDEX IF NOT EXISTS portal_access_token_idx    ON customer_portal_access(access_token) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS portal_access_order_idx    ON customer_portal_access(order_id);

-- ─── E-signature requests ────────────────────────────────────────────────────
-- Provider adapter: records state for DocuSign/HelloSign/Dropbox Sign.
-- Actual API calls require ESIGN_PROVIDER_API_KEY and ESIGN_WEBHOOK_SECRET env vars.

CREATE TABLE IF NOT EXISTS sales_signature_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  order_id              uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  doc_id                uuid        REFERENCES sales_order_docs(id),
  provider              text        DEFAULT 'hellosign',  -- hellosign | docusign
  provider_request_id   text,       -- provider's envelope/signature-request ID
  status                text        DEFAULT 'draft'
                          CHECK (status IN ('draft','awaiting','signed','declined','expired','error')),
  signer_email          text        NOT NULL,
  signer_name           text,
  signed_at             timestamptz,
  signed_doc_path       text,       -- storage path for completed signed document
  provider_data         jsonb       DEFAULT '{}'::jsonb,  -- raw provider webhook payload for audit
  webhook_processed_at  timestamptz,
  webhook_event_ids     text[]      DEFAULT '{}',  -- deduplicate repeated webhook events
  expiry_at             timestamptz,
  created_by            uuid        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS sig_requests_order_idx    ON sales_signature_requests(order_id);
CREATE INDEX IF NOT EXISTS sig_requests_provider_idx ON sales_signature_requests(provider_request_id) WHERE provider_request_id IS NOT NULL;

-- ─── Email notification log ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_email_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  order_id        uuid        REFERENCES sales_orders(id) ON DELETE SET NULL,
  template        text        NOT NULL,  -- portal_invite|contract_ready|order_confirmed|delivery_scheduled|etc.
  to_email        text        NOT NULL,
  subject         text,
  status          text        DEFAULT 'sent' CHECK (status IN ('sent','failed','bounced')),
  provider_id     text,       -- Resend message ID for delivery tracking
  error_message   text,
  dedup_key       text,       -- prevent duplicate sends for the same event
  sent_by         uuid        REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_email_dedup_idx ON sales_email_log(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_email_order_idx ON sales_email_log(order_id);

-- ─── Sequence table for order numbers ───────────────────────────────────────
-- Generates sequential order numbers per division per year atomically.

CREATE TABLE IF NOT EXISTS sales_order_sequences (
  id          serial      PRIMARY KEY,
  division    text        NOT NULL,
  year        int         NOT NULL,
  last_seq    int         NOT NULL DEFAULT 0,
  UNIQUE (division, year)
);

-- RPC function called by /api/sales-orders to generate sequential order numbers.
-- Returns the new sequence value for the given division + year atomically.
CREATE OR REPLACE FUNCTION increment_sales_order_seq(p_division text, p_year int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq int;
BEGIN
  INSERT INTO sales_order_sequences (division, year, last_seq)
  VALUES (p_division, p_year, 1)
  ON CONFLICT (division, year)
  DO UPDATE SET last_seq = sales_order_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END;
$$;

-- ─── Leaderboard view (read-only, no sensitive data) ────────────────────────
-- Only counts orders where stage = 'contract_signed' or later (excluding cancelled).
-- Join to profiles to get salesperson details.

CREATE OR REPLACE VIEW sales_leaderboard AS
SELECT
  o.salesperson_id,
  o.salesperson_name,
  o.division,
  date_trunc('month', o.won_at)::date          AS won_month,
  date_trunc('year',  o.won_at)::date          AS won_year,
  COUNT(*)                                      AS signed_count,
  SUM(o.contract_value)                         AS signed_value,
  -- internal_cost and estimated_profit intentionally excluded from view
  -- query them directly with role checks in application code
  NULL::numeric                                 AS gross_profit  -- sentinel: fetch separately with auth check
FROM sales_orders o
WHERE o.stage NOT IN ('lead','quoted','cancelled')
  AND o.won_at IS NOT NULL
  AND o.is_preview_data = false
GROUP BY o.salesperson_id, o.salesperson_name, o.division,
         date_trunc('month', o.won_at), date_trunc('year', o.won_at);

-- ─── RLS (Row Level Security) ────────────────────────────────────────────────
-- These tables use service-role (adminSupabase) for all writes from API routes.
-- Browser-client reads use RLS below. Customer portal uses service-role reads
-- gated by token validation in /api/customer-portal route.

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_email_log ENABLE ROW LEVEL SECURITY;

-- Internal users (pm, apm, admin, metal_rep, roofing_rep, super) can read all orders
CREATE POLICY "sales_orders_internal_read" ON sales_orders
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_order_docs_internal_read" ON sales_order_docs
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_order_tasks_internal_read" ON sales_order_tasks
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_order_updates_internal_read" ON sales_order_updates
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_order_history_internal_read" ON sales_order_history
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_sig_requests_internal_read" ON sales_signature_requests
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

CREATE POLICY "sales_email_log_internal_read" ON sales_email_log
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep')
  );

-- customer_portal_access: only pm/apm/admin can view
CREATE POLICY "portal_access_pm_read" ON customer_portal_access
  FOR SELECT USING (
    get_my_role() IN ('pm','apm','admin')
  );

-- ─── role_permissions seed rows ─────────────────────────────────────────────
-- Insert default permissions for the new sales tab.
-- Use INSERT ... ON CONFLICT DO NOTHING to be idempotent.

INSERT INTO role_permissions (role, feature_key, enabled) VALUES
  ('pm',           'tab.sales',          true),
  ('apm',          'tab.sales',          true),
  ('admin',        'tab.sales',          true),
  ('super',        'tab.sales',          false),
  ('metal_rep',    'tab.sales',          true),
  ('roofing_rep',  'tab.sales',          true),
  ('pm',           'sales.financials',   true),
  ('apm',          'sales.financials',   true),
  ('admin',        'sales.financials',   true),
  ('super',        'sales.financials',   false),
  ('metal_rep',    'sales.financials',   false),
  ('roofing_rep',  'sales.financials',   false),
  ('pm',           'sales.leaderboard',  true),
  ('apm',          'sales.leaderboard',  true),
  ('admin',        'sales.leaderboard',  true),
  ('metal_rep',    'sales.leaderboard',  true),
  ('roofing_rep',  'sales.leaderboard',  true)
ON CONFLICT (role, feature_key) DO NOTHING;
