-- Migration 024: Sales workflow improvements
-- Adds payment/delivery/installation status dimensions, supplier orders,
-- payment records, readiness checks, split attribution, and links
-- purchase_orders to sales_orders.
-- Safe to run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- ─── Status dimensions on sales_orders ───────────────────────────────────────

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'none'
    CHECK (payment_status IN ('none','deposit_pending','deposit_received','partial','paid','refunded')),
  ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'not_ordered'
    CHECK (delivery_status IN ('not_ordered','ordered','partially_delivered','delivered','exception')),
  ADD COLUMN IF NOT EXISTS installation_status text DEFAULT 'not_scheduled'
    CHECK (installation_status IN ('not_scheduled','scheduled','in_progress','installed','corrections_outstanding')),
  ADD COLUMN IF NOT EXISTS prev_stage text,           -- preserved on on_hold / cancellation
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,     -- already exists in 023, guard handles it
  ADD COLUMN IF NOT EXISTS override_stage_reason text; -- recorded when a gated stage is forced

-- ─── Salesperson attribution stored at signing ───────────────────────────────
-- signed_salesperson_id captures who was assigned AT THE MOMENT of contract signing.
-- Reassigning the order later does not change commission attribution.

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS signed_salesperson_id   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_salesperson_name text,
  ADD COLUMN IF NOT EXISTS signed_contract_value   numeric; -- locked at signing

-- ─── Split-sale attribution ───────────────────────────────────────────────────
-- Supports co-sells. Shares must total 100 per order.

CREATE TABLE IF NOT EXISTS sales_attribution (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  order_id        uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  salesperson_id  uuid        REFERENCES auth.users(id),
  salesperson_name text       NOT NULL,
  share_pct       numeric     NOT NULL DEFAULT 100 CHECK (share_pct > 0 AND share_pct <= 100),
  recorded_at     timestamptz DEFAULT now(),  -- snapshot at signing
  recorded_by     uuid        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS sales_attr_order_idx ON sales_attribution(order_id);
CREATE INDEX IF NOT EXISTS sales_attr_rep_idx   ON sales_attribution(salesperson_id);

-- ─── Payment records ──────────────────────────────────────────────────────────
-- Derives payment_status from individual payment records rather than a checkbox.

CREATE TABLE IF NOT EXISTS sales_order_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  order_id         uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  payment_type     text        DEFAULT 'deposit'
                     CHECK (payment_type IN ('deposit','progress','final','refund','other')),
  amount           numeric     NOT NULL,
  payment_date     date,
  reference        text,       -- check #, wire ref, etc.
  notes            text,
  verified         boolean     DEFAULT false,
  verified_by_name text,
  verified_at      timestamptz,
  recorded_by      uuid        REFERENCES auth.users(id),
  recorded_by_name text
);

CREATE INDEX IF NOT EXISTS sales_payments_order_idx ON sales_order_payments(order_id);

-- ─── Supplier/purchasing orders linked to a sales order ───────────────────────
-- One sales order can have multiple supplier orders (partial deliveries, etc.).
-- When a job is later created, link it via the existing purchase_orders.job_id path.

CREATE TABLE IF NOT EXISTS sales_supplier_orders (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  order_id               uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  supplier_id            uuid        REFERENCES mb_suppliers(id),
  supplier_name          text,
  supplier_ref           text,       -- supplier's own PO / confirmation number
  internal_po_ref        text,       -- our internal PO reference
  status                 text        DEFAULT 'not_ordered'
                           CHECK (status IN ('not_ordered','submitted','confirmed','partially_delivered','delivered','exception','cancelled')),
  ordered_at             timestamptz,
  confirmed_at           timestamptz,
  confirmation_number    text,
  expected_delivery_date date,
  confirmed_delivery_date date,
  delivery_notes         text,
  carrier                text,
  tracking_number        text,
  ordered_items          jsonb       DEFAULT '[]'::jsonb,  -- [{name, qty, unit, unit_price}]
  delivered_items        jsonb       DEFAULT '[]'::jsonb,  -- [{name, qty_received, received_at, notes}]
  shortage_notes         text,
  damage_notes           text,
  created_by             uuid        REFERENCES auth.users(id),
  created_by_name        text,
  linked_purchase_order_id uuid      -- FK to purchase_orders.id (no FK constraint — table may not be in schema)
);

CREATE INDEX IF NOT EXISTS sales_supplier_orders_order_idx ON sales_supplier_orders(order_id);

-- ─── Readiness checks ────────────────────────────────────────────────────────
-- Configurable pre-installation checklist per order.

CREATE TABLE IF NOT EXISTS sales_order_readiness_checks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  order_id         uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  check_type       text        NOT NULL,  -- e.g. 'foundation','permits','site_access','utility_clearance','site_contact','customer_confirm','materials'
  label            text        NOT NULL,
  required_for_scheduling boolean DEFAULT true,
  status           text        DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','complete','na','blocked')),
  responsible_name text,
  notes            text,
  evidence_doc_id  uuid        REFERENCES sales_order_docs(id),
  completed_at     timestamptz,
  completed_by     uuid        REFERENCES auth.users(id),
  completed_by_name text
);

CREATE INDEX IF NOT EXISTS readiness_checks_order_idx ON sales_order_readiness_checks(order_id);

-- ─── Link purchase_orders to sales_orders ─────────────────────────────────────
-- Allows purchasing records to be associated with a sales order before a job exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders'
  ) THEN
    ALTER TABLE purchase_orders
      ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS purchase_orders_sales_idx ON purchase_orders(sales_order_id)
  WHERE sales_order_id IS NOT NULL;

-- ─── Stage gate log ───────────────────────────────────────────────────────────
-- Records every blocked advancement attempt and every authorized override.

CREATE TABLE IF NOT EXISTS sales_stage_gate_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  order_id     uuid        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  actor_id     uuid        REFERENCES auth.users(id),
  actor_name   text,
  from_stage   text,
  to_stage     text,
  outcome      text        NOT NULL CHECK (outcome IN ('blocked','allowed','override')),
  blockers     jsonb       DEFAULT '[]'::jsonb,
  override_reason text
);

CREATE INDEX IF NOT EXISTS stage_gate_order_idx ON sales_stage_gate_log(order_id);

-- ─── RLS for new tables ───────────────────────────────────────────────────────

ALTER TABLE sales_attribution            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_supplier_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_readiness_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_stage_gate_log         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_attribution_internal_read"     ON sales_attribution            FOR SELECT USING (get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep'));
CREATE POLICY "sales_payments_internal_read"        ON sales_order_payments         FOR SELECT USING (get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep'));
CREATE POLICY "sales_supplier_orders_internal_read" ON sales_supplier_orders        FOR SELECT USING (get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep'));
CREATE POLICY "sales_readiness_internal_read"       ON sales_order_readiness_checks FOR SELECT USING (get_my_role() IN ('pm','apm','admin','super','metal_rep','roofing_rep'));
CREATE POLICY "sales_gate_log_internal_read"        ON sales_stage_gate_log         FOR SELECT USING (get_my_role() IN ('pm','apm','admin'));

-- ─── Seed default readiness-check templates per division ─────────────────────
-- These are template rows used by the API when creating new orders.
-- Stored in a separate config table so admins can extend them without code changes.

CREATE TABLE IF NOT EXISTS sales_readiness_templates (
  id          serial      PRIMARY KEY,
  division    text        NOT NULL,  -- metal_buildings | commercial_roofing | both
  check_type  text        NOT NULL,
  label       text        NOT NULL,
  required_for_scheduling boolean DEFAULT true,
  sort_order  int         DEFAULT 0
);

INSERT INTO sales_readiness_templates (division, check_type, label, required_for_scheduling, sort_order) VALUES
  ('metal_buildings',    'foundation',        'Foundation / slab ready',                  true,  1),
  ('metal_buildings',    'site_access',       'Site access and delivery route confirmed',  true,  2),
  ('metal_buildings',    'permits',           'Building permits obtained',                 true,  3),
  ('metal_buildings',    'utility_clearance', 'Utility / overhead clearances checked',     true,  4),
  ('metal_buildings',    'site_contact',      'On-site contact confirmed',                 false, 5),
  ('metal_buildings',    'customer_confirm',  'Customer confirmed install date',           false, 6),
  ('metal_buildings',    'materials',         'All materials confirmed available',         true,  7),
  ('commercial_roofing', 'site_access',       'Roof access confirmed',                     true,  1),
  ('commercial_roofing', 'permits',           'Applicable permits obtained',               true,  2),
  ('commercial_roofing', 'materials',         'Materials ordered and confirmed',            true,  3),
  ('commercial_roofing', 'site_contact',      'Building contact confirmed',                false, 4),
  ('commercial_roofing', 'customer_confirm',  'Customer confirmed schedule',               false, 5),
  ('commercial_roofing', 'site_conditions',   'Site conditions assessed',                  true,  6)
ON CONFLICT DO NOTHING;
