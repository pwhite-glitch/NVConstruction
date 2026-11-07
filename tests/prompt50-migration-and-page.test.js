/**
 * Prompt 50: static checks on migrations/046 (read as text, never applied) and on
 * the residential page wiring for items 4, 8, 9, 14, 16 (canonical tables/buckets,
 * visible errors, hide_budget, no legacy writes).
 */
import fs from 'fs'
import path from 'path'

const dir = path.join(__dirname, '..', 'migrations')
const sql = fs.readFileSync(path.join(dir, '046_residential_access_and_bank_draws.sql'), 'utf8')
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const topLevel = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/\$migration\$[\s\S]*?\$migration\$/g, '')
const page = fs.readFileSync(path.join(__dirname, '..', 'app/residentialjobdetail/page.js'), 'utf8')
const RES = ['res_inspections', 'res_lien_waivers', 'res_owner_draws', 'res_punch_list']

describe('migration 046 (written, not applied)', () => {
  test('next number after 045, says NOT APPLIED, 042 untouched', () => {
    const nums = fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(Number.isFinite)
    // 047 (prompt 51 cash outlook, also written-not-applied) may follow it.
    expect([46, 47]).toContain(Math.max(...nums))
    expect(nums.filter(n => n === 46)).toHaveLength(1)
    expect(sql).toMatch(/NOT APPLIED/)
    expect(code).not.toMatch(/042_/)
  })
  test('replaces EVERY policy on the four res_* tables (auth_all included), RLS on', () => {
    expect(code).toMatch(/FROM pg_policies\s+WHERE schemaname = 'public'\s+AND tablename IN \('res_inspections', 'res_lien_waivers', 'res_owner_draws', 'res_punch_list'\)/)
    expect(code).toMatch(/EXECUTE format\('DROP POLICY %I ON public\.%I', pol\.policyname, pol\.tablename\)/)
    for (const t of RES) expect(code).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    // no permissive policy is created
    expect(code).not.toMatch(/USING \(true\)/i)
    expect(code).not.toMatch(/CREATE POLICY "auth_all"/)
  })
  test('office-only predicate from trusted helpers; no user_metadata', () => {
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.res_job_office_access\(p_job_id text\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/)
    expect(code).toMatch(/get_my_role\(\) IN \('principal', 'admin'\) THEN true/)
    expect(code).toMatch(/get_my_role\(\) IN \('pm', 'apm'\)/)
    expect(code).toMatch(/pm_job_assignments a\s+WHERE a\.job_id::text = p_job_id AND a\.user_id = auth\.uid\(\)/)
    expect(code).not.toMatch(/user_metadata|raw_user_meta/i)
    expect(code).not.toMatch(/'(subcontractor|owner|roofing_rep|metal_rep|super)'/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.res_job_office_access\(text\) FROM PUBLIC, anon;/)
  })
  test('policies: FOR ALL with USING + WITH CHECK on three tables; draws are browser-read-only', () => {
    for (const t of ['res_inspections', 'res_lien_waivers', 'res_punch_list']) {
      expect(code).toMatch(new RegExp(`CREATE POLICY "${t}_office_all" ON public\\.${t} FOR ALL TO authenticated\\s+USING \\(public\\.res_job_office_access\\(${t}\\.job_id::text\\)\\)\\s+WITH CHECK \\(public\\.res_job_office_access\\(${t}\\.job_id::text\\)\\)`))
    }
    expect(code).toMatch(/CREATE POLICY "res_owner_draws_office_select" ON public\.res_owner_draws FOR SELECT TO authenticated/)
    expect(code).not.toMatch(/ON public\.res_owner_draws FOR (ALL|INSERT|UPDATE|DELETE)/)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public\.res_owner_draws FROM authenticated/)
  })
  test('PROPOSED draw columns + validated JSONB, no backfill or data change', () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS amount_funded\s+numeric;/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS schedule_lines jsonb;/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS attachments\s+jsonb;/)
    expect(code).toMatch(/jsonb_typeof\(schedule_lines\) = 'array'\) NOT VALID/)
    expect(code).toMatch(/amount_funded >= 0\) NOT VALID/)
    expect(sql).toMatch(/PROPOSED/)
    expect(topLevel).not.toMatch(/^\s*(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/im)
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i)
    expect(code).not.toMatch(/amount_funded\s*=\s*amount_requested/i)
  })
  test('sent draws keep their money (trigger), void stays void', () => {
    expect(code).toMatch(/CREATE TRIGGER res_owner_draws_lock BEFORE UPDATE OR DELETE ON public\.res_owner_draws/)
    expect(code).toMatch(/NEW\.amount_requested IS DISTINCT FROM OLD\.amount_requested/)
    expect(code).toMatch(/NEW\.schedule_lines\s+IS DISTINCT FROM OLD\.schedule_lines/)
    expect(code).toMatch(/a void draw stays void/)
  })
})

describe('residential page wiring', () => {
  test('photos: shared job_photos + private daily-report-photos, signed URLs, no public bucket/url column', () => {
    expect(page).not.toMatch(/job-photos|getPublicUrl|url: publicUrl/)
    expect(page).toContain("supabase.storage.from('daily-report-photos').createSignedUrls(")
    expect(page).toMatch(/from\('job_photos'\)\.insert\(\{ job_id: id, super_id: [^}]*storage_path: path, file_name: file\.name/)
    expect(page).toContain("await supabase.storage.from('daily-report-photos').remove([path])") // failed row → cleanup
    expect(page).toContain("api('/api/delete-photo'")
    expect(page).toContain("supabase.from('daily_reports').select('id, report_date, photos')")
  })
  test('docs: job_documents via job-scoped route; legacy job_docs read-only', () => {
    expect(page).toContain('include=documents')
    expect(page).toContain("action: 'insert-document'")
    expect(page).not.toContain("action: 'insert-doc'")
    expect(page).toContain('Older documents (read-only)')
  })
  test('punch: shared API only, no res_punch_list writes', () => {
    expect(page).toContain("api('/api/punch-list', jsonOpts('POST'")
    expect(page).not.toMatch(/from\('res_punch_list'\)\.(insert|update|delete)/)
  })
  test('waivers: billing e-signed first, manual log labeled as not e-signed', () => {
    expect(page.indexOf('Waivers on approved sub billings')).toBeLessThan(page.indexOf('Manual waiver log'))
    expect(page).toContain('These are records only, not e-signatures.')
  })
  test('sub COs loaded through the contract join, not added to the homeowner contract', () => {
    expect(page).toContain(".select('*, subcontracts!inner(id, job_id, vendor_name)')")
    expect(page).toContain('committedTotalForLines(contracts, subCOs, budgetItems)')
    expect(page).toContain('const revisedContractTotal = revisedContract(job, changeOrders)')
  })
  test('details: allow-listed API, on_hold spelling, permit + PM + schedules; no end_date/sqft', () => {
    expect(page).toContain("api('/api/jobs/details'")
    expect(page).not.toMatch(/value="on-hold"/)
    expect(page).not.toMatch(/end_date|sqft/)
    expect(page).toMatch(/permit_number/)
    expect(page).toContain('<BillingScheduleFields title="Owner / lender billing" prefix="owner"')
    expect(page).not.toMatch(/supabase\.from\('jobs'\)\.update/)
  })
  test('overview, header KPIs, Complete != Archive, tab in URL, dead TABS removed', () => {
    expect(page).toContain("visibleTab === 'overview'")
    expect(page).toContain('Complete Job & Report')
    expect(page).toContain("fields: { status: 'complete' }")
    expect(page).not.toMatch(/archived: true/)
    expect(page).toContain("params.set('tab', activeTab)")
    expect(page).not.toMatch(/^const TABS = /m)
  })
  test('hide_budget: no Cost/Bank amounts fetched, Budget tab hidden', () => {
    expect(page).toContain("const cols = hide ? 'id, job_id, description, cost_code, sort_order' : '*'")
    expect(page).toContain("...(!hideBudget ? [{ key: 'budget', label: 'Budget' }] : [])")
  })
  test('sub roles and client owners are sent to their portal', () => {
    expect(page).toContain("if (!['principal', 'pm', 'apm', 'admin', 'super'].includes(prof.role)) { router.push(homePathForRole(prof.role)); return }")
  })
  test('light theme: no near-black panels or dark-theme blue left', () => {
    expect(page).not.toMatch(/#0d0a00|#0a1a0a|#1a3a1a|#60a5fa|'1px solid #222'|'1px solid #111'/)
    expect(page).toContain("['rejected', 'Rejected',")
  })
  test('writes surface errors and keep the form open', () => {
    for (const fn of ['addInspection', 'addLienWaiver', 'addContact', 'addPunchItem']) {
      const body = page.slice(page.indexOf(`async function ${fn}(`), page.indexOf(`async function ${fn}(`) + 1400)
      expect(body).toMatch(/Error: ' \+ (error\.message|r\.error)\); return \}/)
    }
  })
  test('inspections: reschedule leaves actual_date empty; re-inspect inserts a new row', () => {
    const resched = page.slice(page.indexOf('async function rescheduleInspection'), page.indexOf('async function reinspect'))
    expect(resched).toContain("result: 'pending', actual_date: null")
    const re = page.slice(page.indexOf('async function reinspect'), page.indexOf('async function punchFromInspection'))
    expect(re).toContain("from('res_inspections').insert(")
    expect(re).not.toMatch(/\.update\(/)
    expect(page).toContain('Permit: {job.permit_number ?')
  })
})
