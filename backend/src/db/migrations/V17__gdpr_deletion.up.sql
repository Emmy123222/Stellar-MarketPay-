ALTER TABLE profiles ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN deletion_status VARCHAR(50) DEFAULT 'active';
CREATE INDEX idx_profiles_deletion_status ON profiles (deletion_status);
