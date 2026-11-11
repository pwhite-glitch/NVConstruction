-- Remove the bucket-specific 50 MiB ceiling; project-wide Storage limits still apply.
-- Does not change bucket privacy, MIME restrictions, or Storage RLS policies.
UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'sales-docs' AND file_size_limit = 52428800;
