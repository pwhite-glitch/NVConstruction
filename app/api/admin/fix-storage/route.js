import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKETS = ['job-documents', 'documents', 'billing-docs', 'bid-docs', 'receipts', 'schedule-files']

export async function GET() {
  const results = []
  for (const bucket of BUCKETS) {
    const { data: info, error: infoErr } = await adminSupabase.storage.getBucket(bucket)
    results.push({
      bucket,
      exists: !infoErr,
      public: info?.public,
      fileSizeLimit: info?.file_size_limit,
      allowedMimeTypes: info?.allowed_mime_types,
      infoError: infoErr?.message,
    })
  }
  return Response.json({ results })
}
