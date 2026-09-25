- closes #1474
- closes #1476
- closes #1477
- closes #1481

### Changes Made:
- **Disputes**: Added the `get_all_disputes` admin view endpoint to support the new dispute dashboard.
- **Escrow**: Added `update_escrow_amount` to allow clients to top-up active escrows. Also introduced `get_escrow_history` to track and return all state transitions for a specific job.
- **Auctions**: Enforced a minimum bid increment in `auction.rs` to stop malicious dust bidding from freezing auctions.
