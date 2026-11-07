// Job document categories (job_documents.category), same list as the commercial
// page and field app. No imports: browser, API route and tests.
export const JOB_DOC_CATEGORIES = [
  { value: 'plans', label: 'Plans' },
  { value: 'geotech', label: 'Geotech / Soil Reports' },
  { value: 'permits', label: 'Permits' },
  { value: 'specs', label: 'Specifications' },
  { value: 'other', label: 'Other' },
]
export const docCategoryLabel = v => JOB_DOC_CATEGORIES.find(c => c.value === v)?.label || v || 'Other'
