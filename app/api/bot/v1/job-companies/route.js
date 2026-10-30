import { withBot, refuse, refusedMethods, badRequest, notFound, dbError, logBotChange } from '../../../../../lib/bot-api'
import { validateJobCompany } from '../../../../../lib/bot-rules'
import { isCompanyLevelRow } from '../../../../../lib/sub-access'

// Put a company on a job: the Companies tab's "add company" (/api/company-job-access
// action add_company). Adds the company-level job_assignments row; billing stays
// as the company's existing rows have it (off when there are none). No email.
export const POST = withBot(async ({ bot, supabase, request }) => {
  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }
  const { row, error: invalid } = validateJobCompany(body)
  if (invalid) return badRequest(invalid)
  const { job_id, company_id } = row

  const [{ data: job }, { data: company }] = await Promise.all([
    supabase.from('jobs').select('id').eq('id', job_id).maybeSingle(),
    supabase.from('companies').select('id, name').eq('id', company_id).maybeSingle(),
  ])
  if (!job) return notFound('Job not found')
  if (!company) return notFound('Company not found')

  // Existing rows for the company or its people on this job
  const { data: members, error: memErr } = await supabase.from('profiles').select('id').eq('company_id', company_id)
  if (memErr) return dbError(memErr)
  const memberIds = (members || []).map(m => m.id)
  let q = supabase.from('job_assignments').select('id, sub_id, sub_email, billing_enabled').eq('job_id', job_id)
  q = memberIds.length ? q.or(`company_id.eq.${company_id},sub_id.in.(${memberIds.join(',')})`) : q.eq('company_id', company_id)
  const { data: rows, error: rowsErr } = await q
  if (rowsErr) return dbError(rowsErr)

  if ((rows || []).some(isCompanyLevelRow)) return Response.json({ ok: true, already_assigned: true })

  const billingOn = (rows || []).some(r => r.billing_enabled !== false)
  const { data, error } = await supabase.from('job_assignments').insert({
    job_id, company_id, invited_at: new Date().toISOString(), billing_enabled: billingOn,
  }).select('id').single()
  if (error) {
    if (error.code === '23505') return Response.json({ ok: true, already_assigned: true })
    return dbError(error)
  }

  await logBotChange(bot, supabase, {
    job_id, entity_type: 'job_assignment', entity_id: data.id, field_name: 'company',
    new_value: company.name, note: `Company added to job — ${company.name || ''} (billing ${billingOn ? 'on' : 'off'})`,
  })
  return Response.json({ ok: true, id: data.id, billing_enabled: billingOn }, { status: 201 })
})

export const GET = refuse
export const { PUT, PATCH, DELETE } = refusedMethods
