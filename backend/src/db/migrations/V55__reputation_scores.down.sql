-- Issue #1561: Rollback reputation_scores

DROP INDEX IF EXISTS reputation_scores_score_idx;
DROP TABLE IF EXISTS reputation_scores;
