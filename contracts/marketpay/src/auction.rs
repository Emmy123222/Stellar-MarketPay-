pub fn place_bid(amount: u64, current_highest: u64) {
    // Fix: Minimum bid increment requirement to prevent dust bids
    if amount < current_highest + 100 {
        panic!("Bid does not meet the minimum increment requirement");
    }
}
