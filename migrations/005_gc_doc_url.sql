-- Add doc_url column to general_conditions table
-- Required by commit b268fdc (file attachment support for GC entries)
-- Run in Supabase SQL editor or via migration tool

ALTER TABLE general_conditions
  ADD COLUMN IF NOT EXISTS doc_url text;
