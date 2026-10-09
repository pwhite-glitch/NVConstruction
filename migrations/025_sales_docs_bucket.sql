-- ─── Migration 025: sales-docs storage bucket + test data isolation ──────────

-- Provision the private sales-docs bucket.
-- The API (sales-order-docs route) uses the service-role client which bypasses
-- RLS, so uploads/downloads work without storage policies. The policies below
-- are belt-and-suspenders for any future direct-client access.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sales-docs',
  'sales-docs',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg','image/png','image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies (storage.objects)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sales_docs_internal_read'
  ) THEN
    CREATE POLICY sales_docs_internal_read ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'sales-docs'
        AND (SELECT role FROM public.profiles WHERE id = auth.uid())
              IN ('pm','apm','admin','metal_rep','roofing_rep','super')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sales_docs_internal_insert'
  ) THEN
    CREATE POLICY sales_docs_internal_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'sales-docs'
        AND (SELECT role FROM public.profiles WHERE id = auth.uid())
              IN ('pm','apm','admin','metal_rep','roofing_rep')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'sales_docs_admin_delete'
  ) THEN
    CREATE POLICY sales_docs_admin_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'sales-docs'
        AND (SELECT role FROM public.profiles WHERE id = auth.uid())
              IN ('pm','apm','admin')
      );
  END IF;
END $$;

-- Mark named test orders as preview data so they are excluded from
-- operating totals, leaderboard, and customer automation.
UPDATE sales_orders
SET    is_preview_data = true
WHERE  order_number IN ('MB-2026-001', 'RF-2026-001')
  AND  is_preview_data = false;
