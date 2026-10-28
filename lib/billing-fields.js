// Columns each role may write on billing_submissions through /api/billing-entry.
// Anything not listed is dropped silently, so a field the job page sends but
// isn't listed here never gets saved (that is how contact info / description
// went missing on PM-entered billings).

// Fields a PM may set on a new submission (POST)
export const PM_INSERT_FIELDS = new Set([
  'job_id', 'sub_id', 'company_name', 'contact_name', 'contact_info',
  'amount_billed', 'retainage_pct', 'retainage_held', 'pct_complete',
  'work_description', 'invoice_number', 'invoice_date',
  'status', 'notes', 'billing_period', 'draw_request_id', 'doc_url',
  'submitted_at', 'reviewed_at', 'lien_waiver_signed_at',
])
// Fields a sub may set on their own new submission
export const SUB_INSERT_FIELDS = new Set(['job_id', 'amount_billed', 'retainage_held', 'notes', 'billing_period', 'doc_url'])

// Fields a PM may PATCH
export const PM_PATCH_FIELDS = new Set([
  'status', 'company_name', 'contact_name', 'contact_info',
  'amount_billed', 'retainage_pct', 'retainage_held', 'pct_complete',
  'work_description', 'invoice_number', 'invoice_date',
  'notes', 'ready_to_pay', 'lien_waiver_signed_at', 'paid_at', 'doc_url', 'billing_period',
  'payment_amount', 'payment_method', 'check_number', 'payment_notes', 'nv_cuts_check',
  'draw_request_id', 'reviewed_at',
])
// Sub may only update their own pending submission's safe fields
export const SUB_PATCH_FIELDS = new Set(['notes', 'billing_period', 'doc_url'])

// Columns added by migration 032. Until it is applied, writes that include them
// fail with a "schema cache" error and are retried without them.
export const NEW_032_COLS = new Set(['invoice_date'])

export function withoutNew032(row) {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !NEW_032_COLS.has(k)))
}

export function pickFields(obj, allowed) {
  const result = {}
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}
