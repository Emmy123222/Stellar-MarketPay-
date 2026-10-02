ALTER TABLE referrals
  ALTER COLUMN status SET DEFAULT 'pending';

UPDATE referrals
  SET status = 'pending'
  WHERE status = 'referral_credit_pending';
