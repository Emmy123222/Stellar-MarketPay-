-- Issue #1560: Opt-in auto-conversion of XLM earnings to USDC after each escrow release.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_convert_usdc BOOLEAN NOT NULL DEFAULT FALSE,
  -- Maximum slippage the freelancer accepts on the swap, in basis points (100 = 1%).
  ADD COLUMN IF NOT EXISTS auto_convert_slippage_bps INTEGER NOT NULL DEFAULT 100
    CHECK (auto_convert_slippage_bps BETWEEN 10 AND 1000);

-- Payment history for auto-conversions. A row is created in 'pending' state when
-- an escrow is released to a freelancer who has opted in; the freelancer's
-- wallet then signs a pathPaymentStrictSend (XLM -> USDC, to self) and the
-- result (tx hash, amounts, effective rate) is recorded here.
CREATE TABLE IF NOT EXISTS usdc_auto_conversions (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address        TEXT          NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
  job_id              UUID          REFERENCES jobs(id) ON DELETE SET NULL,
  milestone_index     INTEGER,                    -- NULL for a full escrow release
  source_amount_xlm   NUMERIC(20,7) NOT NULL CHECK (source_amount_xlm > 0),
  quoted_usdc         NUMERIC(20,7),              -- best path quote at release time
  dest_min_usdc       NUMERIC(20,7),              -- min USDC after slippage
  received_usdc       NUMERIC(20,7),              -- actual USDC received on-chain
  exchange_rate       NUMERIC(20,7),              -- USDC per XLM actually obtained
  tx_hash             TEXT,
  status              TEXT          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
  error               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

-- One conversion per release: full release (milestone_index NULL) or per milestone.
CREATE UNIQUE INDEX IF NOT EXISTS usdc_auto_conversions_release_uniq
  ON usdc_auto_conversions (user_address, job_id, (COALESCE(milestone_index, -1)));

CREATE INDEX IF NOT EXISTS usdc_auto_conversions_user_created_idx
  ON usdc_auto_conversions (user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS usdc_auto_conversions_pending_idx
  ON usdc_auto_conversions (user_address) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS usdc_auto_conversions_tx_hash_idx
  ON usdc_auto_conversions (tx_hash) WHERE tx_hash IS NOT NULL;
