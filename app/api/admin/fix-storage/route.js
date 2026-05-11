import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKETS = ['job-documents', 'documents', 'billing-docs', 'bid-docs', 'receipts', 'schedule-files']

export async function GET(request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = []
  for (const bucket of BUCKETS) {
    const { data, error } = await adminSupabase.storage.updateBucket(bucket, {
      fileSizeLimit: 524288000, // 500MB
    })
    results.push({ bucket, ok: !error, error: error?.message })
  }

  return Response.json({ results })
}
