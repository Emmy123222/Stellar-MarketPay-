-- Remove size limit constraint on scope session content (Issue #1457)
ALTER TABLE scope_sessions
  DROP CONSTRAINT IF EXISTS scope_sessions_content_size_check;
