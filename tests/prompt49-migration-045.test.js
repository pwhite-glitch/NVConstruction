/**
 * Static checks on migrations/045_billing_integrity_co_numbers_lookahead.sql.
 * The SQL is read as text only — nothing is executed or applied.
 */
import fs from 'fs'
import path from 'path'

const dir = path.join(__dirname, '..', 'migrations')
const sql = fs.readFileSync(path.join(dir, '045_billing_integrity_co_numbers_lookahead.sql'), 'utf8')
// Statements outside comments
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
// Top-level statements (function bodies between $$ removed)
const topLevel = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/\$migration\$[\s\S]*?\$migration\$/g, '')

describe('migration 045 definitions', () => {
  test('is the next number after 044 and says it is not applied', () => {
    const nums = fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(Number.isFinite)
    // 045 follows 044 and its number is unique (later migrations, e.g. 046, may exist)
    expect(nums).toContain(44)
    expect(nums.filter(n => n === 45)).toHaveLength(1)
    expect(sql).toMatch(/NOT APPLIED/)
  })
  test('PROPOSED nullable co_number on both CO tables, scoped unique indexes', () => {
    expect(code).toMatch(/ALTER TABLE public\.prime_change_orders ADD COLUMN IF NOT EXISTS co_number integer;/)
    expect(code).toMatch(/ALTER TABLE public\.change_orders\s+ADD COLUMN IF NOT EXISTS co_number integer;/)
    expect(code).toMatch(/UNIQUE INDEX IF NOT EXISTS prime_change_orders_job_co_number_key\s+ON public\.prime_change_orders \(job_id, co_number\) WHERE co_number IS NOT NULL/)
    expect(code).toMatch(/UNIQUE INDEX IF NOT EXISTS change_orders_subcontract_co_number_key\s+ON public\.change_orders \(subcontract_id, co_number\) WHERE co_number IS NOT NULL/)
  })
  test('numbers assigned in the DB under a per-scope lock; client value overwritten', () => {
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('prime_co_number:' \|\| NEW\.job_id::text/)
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtextextended\('sub_co_number:' \|\| NEW\.subcontract_id::text/)
    expect(code).toMatch(/SELECT coalesce\(max\(co_number\), 0\) \+ 1 INTO NEW\.co_number/)
    expect(code).toMatch(/CREATE TRIGGER prime_co_number_insert BEFORE INSERT ON public\.prime_change_orders/)
    expect(code).toMatch(/CREATE TRIGGER sub_co_number_insert BEFORE INSERT ON public\.change_orders/)
  })
  test('immutable and never freed by a delete', () => {
    expect(code).toMatch(/co_number_immutable/)
    expect(code).toMatch(/CREATE TRIGGER prime_co_number_delete BEFORE DELETE/)
    expect(code).toMatch(/CREATE TRIGGER sub_co_number_delete BEFORE DELETE/)
    expect(code).toMatch(/OLD\.co_number IS NOT NULL AND EXISTS \(SELECT 1 FROM public\.jobs/)
  })
  test('no historical backfill / data edits: no top-level UPDATE, DELETE or INSERT', () => {
    expect(topLevel).not.toMatch(/^\s*UPDATE\s/im)
    expect(topLevel).not.toMatch(/^\s*DELETE\s+FROM/im)
    expect(topLevel).not.toMatch(/^\s*INSERT\s+INTO/im)
    expect(code).not.toMatch(/UPDATE\s+public\.(prime_change_orders|change_orders)\b/i)
    expect(topLevel).not.toMatch(/^\s*TRUNCATE\b/im) // (TRUNCATE in a REVOKE privilege list is fine)
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i)
  })
  test('atomic pay-app draw function, service role only, compare-and-set on the line', () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS drawn_aia_delta numeric/)
    expect(code).toMatch(/CREATE OR REPLACE FUNCTION public\.aia_dc_draw_apply\(/)
    expect(code).toMatch(/FOR UPDATE;\s+IF NOT FOUND THEN RAISE EXCEPTION 'aia_dc_not_found'/)
    expect(code).toMatch(/l\.dollar_this_period IS DISTINCT FROM p_expected_this/)
    expect(code).toMatch(/aia_app_locked/)
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.aia_dc_draw_apply\([^)]*\)\s+TO service_role/)
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.aia_dc_draw_apply\([^)]*\)\s+FROM PUBLIC, anon, authenticated/)
  })
  test('billed SOV lines protected; permissive policies closed, not just joined by a new one', () => {
    expect(code).toMatch(/CREATE TRIGGER subcontract_sov_lines_billed_guard BEFORE UPDATE OR DELETE ON public\.subcontract_sov_lines/)
    expect(code).toMatch(/PERFORM 1 FROM public\.subcontract_sov_lines WHERE id = v_id FOR UPDATE/)
    expect(code).toMatch(/DROP POLICY IF EXISTS "Authenticated manage subcontract_sov_lines" ON public\.subcontract_sov_lines/)
    expect(code).toMatch(/DROP POLICY IF EXISTS "Authenticated manage billing_sov_lines"\s+ON public\.billing_sov_lines/)
    expect(code).toMatch(/btrim\(coalesce\(qual, ''\)\) = 'true'/)
    expect(code).toMatch(/"subcontract_sov_lines_office_select" ON public\.subcontract_sov_lines FOR SELECT/)
    expect(code).toMatch(/"billing_sov_lines_office_select" ON public\.billing_sov_lines FOR SELECT/)
    expect(code).not.toMatch(/CREATE POLICY[^;]*USING \(true\)/i)
    expect(code).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES\s+ON public\.subcontract_sov_lines, public\.billing_sov_lines FROM authenticated/)
  })
  test('lookahead columns: approved_at and send-back note', () => {
    for (const c of ['approved_at', 'returned_at', 'returned_by', 'returned_by_name', 'return_note']) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.lookaheads ADD COLUMN IF NOT EXISTS ${c}\\b`))
    }
  })
  test('does not touch migration 042 or invented tables', () => {
    expect(code).not.toMatch(/aia_line_items/)
    expect(code).not.toMatch(/nv_subcontracts/)
    expect(sql).not.toMatch(/\\i .*042/)
  })
})
