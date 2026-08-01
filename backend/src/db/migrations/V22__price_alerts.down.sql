-- V22__price_alerts.down.sql
-- Drop the price_alerts table and related indexes

DROP INDEX IF EXISTS idx_price_alerts_triggered;
DROP INDEX IF EXISTS idx_price_alerts_user;
DROP TABLE IF EXISTS price_alerts;
