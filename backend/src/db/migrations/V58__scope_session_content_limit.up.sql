-- Enforce size limit on scope session content to prevent DoS attacks (Issue #1457)
ALTER TABLE scope_sessions
  ADD CONSTRAINT scope_sessions_content_size_check
  CHECK (octet_length(content) <= 524288);
