ALTER TABLE referrals
  ALTER COLUMN status SET DEFAULT 'referral_credit_pending';

UPDATE referrals
  SET status = 'referral_credit_pending'
  WHERE status = 'pending';
