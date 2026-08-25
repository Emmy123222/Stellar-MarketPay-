-- deleted_at may already exist: V12__full_text_search_idempotency_metrics adds
-- it too, and duplicated version numbers make application order alphabetical.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_status VARCHAR(50) DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_status ON profiles (deletion_status);
