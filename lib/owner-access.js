// Owner-portal job access for server routes: client owners only on jobs whose
// owner_email is their login email (same rule as /owner and the RLS policies);
// office staff (dev "view as owner" preview) principal/admin any job, pm/apm/super
// only on their job. Everyone else: 403. Returns null when allowed, else a Response.
import { isPM } from './server-auth'
import { denyUnlessOnJob, normEmail, ilikeExact } from './roles'

const forbidden = () => Response.json({ error: 'Forbidden' }, { status: 403 })

export async function ownerJobDenied(db, auth, jobId) {
  if (!jobId) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (isPM(auth?.role)) return denyUnlessOnJob(db, auth, jobId)
  if (auth?.role !== 'owner') return forbidden()
  const email = normEmail(auth.email)
  if (!email) return forbidden()
  const { data: job, error } = await db.from('jobs').select('id, owner_email').eq('id', jobId).ilike('owner_email', ilikeExact(email)).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return job && normEmail(job.owner_email) === email ? null : forbidden()
}
