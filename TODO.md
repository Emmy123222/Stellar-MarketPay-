# Block Feature Implementation TODO

## Backend
- [ ] 1. `backend/src/db/schema.sql` — Add `blocked_addresses TEXT[]` column to profiles
- [ ] 2. `backend/src/services/profileService.js` — Add `blockFreelancer`, `unblockFreelancer`, `isBlocked`, update `rowToProfile`
- [ ] 3. `backend/src/routes/profiles.js` — Add POST `/block` and DELETE `/block/:address` endpoints with JWT auth
- [ ] 4. `backend/src/services/applicationService.js` — Fix `query`→`pool.query` bug, reject blocked applicants, filter blocked from applicant lists
- [ ] 5. `backend/src/services/jobService.js` — Fix `pool` import bug, add `blocked` flag to `getJob`
- [ ] 6. `backend/src/routes/jobs.js` — Pass `viewer` query param to `getJob`

## Frontend
- [ ] 7. `frontend/utils/types.ts` — Add `blockedAddresses?: string[]` to `UserProfile`
- [ ] 8. `frontend/lib/api.ts` — Add `blockFreelancer` and `unblockFreelancer` API wrappers
- [ ] 9. `frontend/pages/dashboard.tsx` — Add "Blocked Users" tab with management UI
- [ ] 10. `frontend/pages/jobs/[id].tsx` — Show neutral unavailability message when blocked

## Testing / Follow-up
- [ ] Run backend tests
- [ ] Verify database migration on startup
- [ ] Manual test: block, unblock, apply, view job as blocked

