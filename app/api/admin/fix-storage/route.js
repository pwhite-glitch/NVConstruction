import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKETS = ['job-documents', 'documents', 'billing-docs', 'bid-docs', 'receipts', 'schedule-files']

export async function GET() {
  const results = []
  for (const bucket of BUCKETS) {
    const { data, error } = await adminSupabase.storage.updateBucket(bucket, {
      fileSizeLimit: 52428800, // 50MB
    })
    results.push({ bucket, ok: !error, error: error?.message })
  }

  return Response.json({ results })
}
