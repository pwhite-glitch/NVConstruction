-- Add cover image path to jobs table for project gallery
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cover_image_path text;
