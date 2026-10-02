## Summary

Fixes the application submission feedback issue from #1425. The Apply flow now gives immediate confirmation instead of leaving the user watching a spinner while the request completes.

## Type
- [x] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor
- [ ] Smart contract change

## Related Issue
Closes #1425

## Changes

- Immediately changes the submit button text to `Application submitted!` after confirmation.
- Keeps the optimistic state while the application request is pending.
- Permanently disables the button after a successful submission.
- Reverts the button state when the API request fails.
- Shows an error toast when submission fails.
- Removes obsolete page-level optimistic submission and spinner state.

## Testing

- Added regression tests for pending, successful, and failed submissions.
- Editor diagnostics passed for all changed files.
- `git diff --check` passed.
- Jest could not run locally because frontend dependencies could not be fully installed due to npm network `ECONNRESET` errors.

## Screenshots (if UI change)

Not available; the focused browser test environment was unavailable locally.
