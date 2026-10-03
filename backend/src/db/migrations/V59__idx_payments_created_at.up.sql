CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  public_key VARCHAR(255) NOT NULL,
  amount DECIMAL(20, 7) NOT NULL,
  currency VARCHAR(10) DEFAULT 'XLM',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payments_created_at ON payments(created_at);
