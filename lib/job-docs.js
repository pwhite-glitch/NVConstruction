// Job document categories (job_documents.category), same list as the commercial
// page and field app. No imports: browser, API route and tests.
export const JOB_DOC_CATEGORIES = [
  { value: 'plans', label: 'Plans' },
  { value: 'geotech', label: 'Geotech / Soil Reports' },
  { value: 'permits', label: 'Permits' },
  { value: 'specs', label: 'Specifications' },
  { value: 'other', label: 'Other' },
]
// Categories set by a dedicated slot, not the general upload picker (prompt 97: the
// "Billing Schedule (Exhibit B)" slot in Job Details; the newest one is attached to subcontracts).
export const SLOT_DOC_CATEGORIES = [
  { value: 'billing_schedule', label: 'Billing Schedule (Exhibit B)' },
  // Prompt 103: a file uploaded as an extra subcontract exhibit (C, D, …) from Gen Contract.
  { value: 'subcontract_exhibit', label: 'Subcontract Exhibit' },
]
export const isJobDocCategory = v => [...JOB_DOC_CATEGORIES, ...SLOT_DOC_CATEGORIES].some(c => c.value === v)
export const docCategoryLabel = v => [...JOB_DOC_CATEGORIES, ...SLOT_DOC_CATEGORIES].find(c => c.value === v)?.label || v || 'Other'
