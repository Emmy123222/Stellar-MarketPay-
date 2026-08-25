-- V18: Normalised job category taxonomy
-- Adds a categories table with parent/child relationships,
-- migrates jobs.category (text) to jobs.category_id (FK),
-- and seeds the existing flat categories plus subcategories.

-- ─────────────────────────────────────────
-- 1. categories table
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id        SERIAL  PRIMARY KEY,
  slug      TEXT    UNIQUE NOT NULL,
  name      TEXT    NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON categories(parent_id);
CREATE INDEX IF NOT EXISTS categories_slug_idx      ON categories(slug);

-- ─────────────────────────────────────────
-- 2. Seed top-level categories
-- ─────────────────────────────────────────
INSERT INTO categories (slug, name, parent_id) VALUES
  ('smart-contracts',      'Smart Contracts',      NULL),
  ('frontend-development', 'Frontend Development', NULL),
  ('backend-development',  'Backend Development',  NULL),
  ('ui-ux-design',         'UI/UX Design',         NULL),
  ('technical-writing',    'Technical Writing',    NULL),
  ('devops',               'DevOps',               NULL),
  ('security-audit',       'Security Audit',       NULL),
  ('data-analysis',        'Data Analysis',        NULL),
  ('mobile-development',   'Mobile Development',   NULL),
  ('other',                'Other',                NULL)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────
-- 3. Seed subcategories
-- ─────────────────────────────────────────
INSERT INTO categories (slug, name, parent_id)
SELECT 'soroban-contracts', 'Soroban Contracts', id FROM categories WHERE slug = 'smart-contracts'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'token-development', 'Token Development', id FROM categories WHERE slug = 'smart-contracts'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'defi-protocols', 'DeFi Protocols', id FROM categories WHERE slug = 'smart-contracts'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'react-development', 'React Development', id FROM categories WHERE slug = 'frontend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'nextjs-development', 'Next.js Development', id FROM categories WHERE slug = 'frontend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'vue-development', 'Vue Development', id FROM categories WHERE slug = 'frontend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'api-development', 'API Development', id FROM categories WHERE slug = 'backend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'database-design', 'Database Design', id FROM categories WHERE slug = 'backend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'node-development', 'Node.js Development', id FROM categories WHERE slug = 'backend-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'ux-research', 'UX Research', id FROM categories WHERE slug = 'ui-ux-design'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'figma-design', 'Figma Design', id FROM categories WHERE slug = 'ui-ux-design'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'ci-cd', 'CI/CD Pipelines', id FROM categories WHERE slug = 'devops'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'kubernetes', 'Kubernetes', id FROM categories WHERE slug = 'devops'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'docker', 'Docker', id FROM categories WHERE slug = 'devops'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'smart-contract-audit', 'Smart Contract Audit', id FROM categories WHERE slug = 'security-audit'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'penetration-testing', 'Penetration Testing', id FROM categories WHERE slug = 'security-audit'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'ios-development', 'iOS Development', id FROM categories WHERE slug = 'mobile-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'android-development', 'Android Development', id FROM categories WHERE slug = 'mobile-development'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (slug, name, parent_id)
SELECT 'react-native', 'React Native', id FROM categories WHERE slug = 'mobile-development'
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────
-- 4. Add category_id FK to jobs
-- ─────────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────
-- 5. Back-fill category_id from the existing free-text category column
-- ─────────────────────────────────────────
UPDATE jobs j
SET    category_id = c.id
FROM   categories c
WHERE  LOWER(TRIM(j.category)) = REPLACE(LOWER(TRIM(c.slug)), '-', ' ')
   OR  LOWER(TRIM(j.category)) = LOWER(TRIM(c.name))
   AND j.category_id IS NULL;

-- Fallback: map anything unrecognised to 'other'
UPDATE jobs j
SET    category_id = c.id
FROM   categories c
WHERE  c.slug = 'other'
  AND  j.category_id IS NULL;

CREATE INDEX IF NOT EXISTS jobs_category_id_idx ON jobs(category_id);
