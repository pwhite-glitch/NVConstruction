// Server-only. Inserts an rfis row with the next per-job number (max + 1).
// Two inserts racing for the same number: the loser hits the unique index on
// rfis(job_id, number) from migration 040 (Postgres 23505) and retries with a
// fresh max. Without that index a race can still produce duplicate numbers.
export const RFI_NUMBER_RETRIES = 5

export async function nextRfiNumber(db, jobId) {
  const { data, error } = await db
    .from('rfis')
    .select('number')
    .eq('job_id', jobId)
    .not('number', 'is', null)
    .order('number', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return (Number(data?.[0]?.number) || 0) + 1
}

// row: columns for rfis, without number. Returns { data, error }.
export async function insertNumberedRfi(db, row, { retries = RFI_NUMBER_RETRIES } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < retries; attempt++) {
    let number
    try {
      number = await nextRfiNumber(db, row.job_id)
    } catch (e) {
      return { data: null, error: { message: e.message } }
    }
    const { data, error } = await db.from('rfis').insert({ ...row, number }).select('*').single()
    if (!error) return { data, error: null }
    if (error.code !== '23505') return { data: null, error }
    lastError = error
  }
  return { data: null, error: { message: `Could not assign an RFI number after ${retries} tries. Please try again.`, cause: lastError } }
}
