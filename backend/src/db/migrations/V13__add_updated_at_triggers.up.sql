-- V13__add_updated_at_triggers.up.sql

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Dynamically add updated_at column to all user tables that don't have it,
--    and attach the set_updated_at trigger to all tables.
DO $$
DECLARE
    t_record RECORD;
BEGIN
    FOR t_record IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        -- Add updated_at column if it does not exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = t_record.table_name 
              AND column_name = 'updated_at'
        ) THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();', t_record.table_name);
        END IF;

        -- Drop trigger if exists (idempotent)
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', t_record.table_name);
        
        -- Create the trigger
        EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t_record.table_name);
    END LOOP;
END;
$$;
