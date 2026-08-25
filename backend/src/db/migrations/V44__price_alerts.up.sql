-- V44__price_alerts.up.sql
-- New table for price alerts with condition (above/below) and threshold model.
-- Allows multiple alerts per user and supports one-time auto-delete after trigger.

CREATE TABLE IF NOT EXISTS price_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address    VARCHAR(56) NOT NULL,
    condition       VARCHAR(10) NOT NULL CHECK (condition IN ('above', 'below')),
    threshold       NUMERIC(20, 10) NOT NULL,
    one_time        BOOLEAN NOT NULL DEFAULT TRUE,
    triggered       BOOLEAN NOT NULL DEFAULT FALSE,
    triggered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user
    ON price_alerts (user_address);

CREATE INDEX IF NOT EXISTS idx_price_alerts_triggered
    ON price_alerts (triggered)
    WHERE triggered = FALSE;
