-- V57 down

ALTER TABLE escrows
DROP COLUMN next_release_date,
DROP COLUMN anchor_day;
