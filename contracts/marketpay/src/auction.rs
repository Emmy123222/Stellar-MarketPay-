pub fn place_bid(amount: u64, current_highest: u64) {
    // Fix: Minimum bid increment requirement to prevent dust bids
    if amount < current_highest + 100 {
        panic!("Bid does not meet the minimum increment requirement");
    }
}

pub fn place_bid_with_increment(amount: u64, current_highest: u64, min_increment: u64) {
    if amount < current_highest.saturating_add(min_increment) {
        panic!("Bid does not meet the minimum increment requirement");
    }
}
