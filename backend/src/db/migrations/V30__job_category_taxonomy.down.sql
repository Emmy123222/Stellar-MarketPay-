-- Rollback V18: Remove category taxonomy
ALTER TABLE jobs DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS categories;
