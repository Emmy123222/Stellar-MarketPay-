# Database migrations

Migration files use the format `V<number>__description.up.sql` and
`V<number>__description.down.sql`. Keep version numbers unique and add a
rollback file for every new forward migration.

Run the duplicate-version check from the repository root before opening a PR:

```bash
bash scripts/verify-migration-versions.sh
bash scripts/test-verify-migration-versions.sh
```

If a migration version has already been recorded in a deployed database, do
not remove or edit its `schema_migrations` row by hand when resolving a file
name or version collision. Preserve the old name in the migration runner's
compatibility mapping, then update the recorded row transactionally to the new
canonical migration name and version. Keep the migration SQL idempotent when
legacy versions may already have applied the same schema change. This lets
existing databases advance without replaying the migration while fresh
installations use the unique version sequence.
