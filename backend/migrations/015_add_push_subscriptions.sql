-- Create push subscriptions table for Web Push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address VARCHAR(56) NOT NULL,
  endpoint TEXT NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_address, endpoint),
  FOREIGN KEY (user_address) REFERENCES profiles(public_key) ON DELETE CASCADE
);

-- Index for faster lookups by user address
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_address);
CREATE INDEX idx_push_subscriptions_active ON push_subscriptions(is_active);
