-- Migration 012: Commercial Roofing and Metal Buildings pipeline
-- Adds roofing_rep and metal_rep roles, plus three new tables.

-- ── ROLE CONSTRAINT ──────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'pm', 'apm', 'super', 'admin',
    'subcontractor', 'sub_estimator', 'sub_pm', 'sub_admin',
    'roofing_rep', 'metal_rep'
  ));

-- ── MB_SUPPLIERS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mb_suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  notes      text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE mb_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mb_suppliers_select" ON mb_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "mb_suppliers_insert" ON mb_suppliers FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
CREATE POLICY "mb_suppliers_update" ON mb_suppliers FOR UPDATE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
CREATE POLICY "mb_suppliers_delete" ON mb_suppliers FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

-- ── ROOFING_LEADS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roofing_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  assigned_to     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  company_name    text,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  address         text,
  stage           text NOT NULL DEFAULT 'lead'
                    CHECK (stage IN ('lead', 'estimate_sent', 'follow_up', 'won', 'lost')),
  estimate_value  numeric,
  notes           text,
  roof_type       text,
  roof_size_sqft  numeric,
  building_type   text,
  tear_off_needed boolean DEFAULT false,
  tear_off_notes  text,
  lost_reason     text,
  won_date        date
);
ALTER TABLE roofing_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roofing_leads_select" ON roofing_leads FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR (get_my_role() = 'roofing_rep' AND assigned_to = auth.uid())
  );
CREATE POLICY "roofing_leads_insert" ON roofing_leads FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super', 'admin', 'roofing_rep'));
CREATE POLICY "roofing_leads_update" ON roofing_leads FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR (get_my_role() = 'roofing_rep' AND assigned_to = auth.uid())
  );
CREATE POLICY "roofing_leads_delete" ON roofing_leads FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));

-- ── METAL_BUILDING_LEADS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metal_building_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz DEFAULT now(),
  assigned_to       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  company_name      text,
  contact_name      text,
  contact_phone     text,
  contact_email     text,
  address           text,
  stage             text NOT NULL DEFAULT 'lead'
                      CHECK (stage IN ('lead', 'estimate_sent', 'follow_up', 'won', 'lost')),
  estimate_value    numeric,
  deposit_amount    numeric,
  deposit_received  boolean DEFAULT false,
  notes             text,
  width_ft          numeric,
  length_ft         numeric,
  height_ft         numeric,
  building_use      text,
  supplier_id       uuid REFERENCES mb_suppliers(id) ON DELETE SET NULL,
  lost_reason       text,
  won_date          date
);
ALTER TABLE metal_building_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metal_leads_select" ON metal_building_leads FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR (get_my_role() = 'metal_rep' AND assigned_to = auth.uid())
  );
CREATE POLICY "metal_leads_insert" ON metal_building_leads FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('pm', 'apm', 'super', 'admin', 'metal_rep'));
CREATE POLICY "metal_leads_update" ON metal_building_leads FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('pm', 'apm', 'super', 'admin')
    OR (get_my_role() = 'metal_rep' AND assigned_to = auth.uid())
  );
CREATE POLICY "metal_leads_delete" ON metal_building_leads FOR DELETE TO authenticated
  USING (get_my_role() IN ('pm', 'apm', 'super', 'admin'));
