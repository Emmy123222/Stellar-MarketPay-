-- Issue #1560: Rollback USDC auto-convert

DROP INDEX IF EXISTS usdc_auto_conversions_tx_hash_idx;
DROP INDEX IF EXISTS usdc_auto_conversions_release_uniq;
DROP INDEX IF EXISTS usdc_auto_conversions_pending_idx;
DROP INDEX IF EXISTS usdc_auto_conversions_user_created_idx;
DROP TABLE IF EXISTS usdc_auto_conversions;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS auto_convert_slippage_bps,
  DROP COLUMN IF EXISTS auto_convert_usdc;
