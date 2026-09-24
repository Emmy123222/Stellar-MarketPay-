-- V57: Add next_release_date and anchor_day for recurring monthly billing

ALTER TABLE escrows
ADD COLUMN next_release_date TIMESTAMPTZ,
ADD COLUMN anchor_day INTEGER;
