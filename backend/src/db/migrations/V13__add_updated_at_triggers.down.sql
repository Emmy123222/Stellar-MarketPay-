-- V13__add_updated_at_triggers.down.sql

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
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', t_record.table_name);
    END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS set_updated_at();
