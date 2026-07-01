-- V19__tfidf_vocabulary
-- Stores the global term vocabulary and IDF weights for the job recommendation TF-IDF engine

CREATE TABLE IF NOT EXISTS tfidf_vocabulary (
  term TEXT PRIMARY KEY,
  document_frequency INTEGER NOT NULL DEFAULT 0,
  inverse_document_frequency NUMERIC(10,6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS tfidf_vocabulary_term_idx 
  ON tfidf_vocabulary(term);

CREATE INDEX IF NOT EXISTS tfidf_vocabulary_idf_idx 
  ON tfidf_vocabulary(inverse_document_frequency DESC);
