# Changelog

All notable changes to `phattarachai/laravel-db-console` are documented here.

Release notes are drafted automatically from merged pull requests and published on the
[Releases page](https://github.com/phattarachai/laravel-db-console/releases) — that page is the authoritative log.

This file records anything released before that automation landed.

## v1.1.1 — 2026-10-11

### Fixed

- The sidebar's row counts show `~`, as the grid header already did, so the estimate is visible without hovering.
- MySQL `tinyint(1)` booleans display as `true` / `false` in the grid, as Postgres booleans do. Any other value in
  such a column still shows as it is.
- A configured connection label in the toolbar pill uses the UI font; only the database-name fallback is monospace.

## v1.1.0 — 2026-10-11

### Added

- **MySQL 8 and MariaDB support.** Reads run in `START TRANSACTION READ ONLY` and are always rolled back. The timeout
  is `max_execution_time` on MySQL and `max_statement_time` on MariaDB, and the previous session value is restored
  afterwards. Introspection uses `information_schema`, and `schemas` maps to databases. EXPLAIN uses MySQL's
  `FORMAT=TREE` or MariaDB's EXPLAIN table. Booleans stored as `tinyint(1)`, `LIKE` filters and binary columns are
  handled.
- The React starter kit installs with the documented steps alone. A TypeScript host gets `DbConsole.tsx` and
  `types/db-console.d.ts`, the page opts out of the default layout, and the console is SSR-safe.
- A **foreign-key jump filters the referenced table to the referenced row**.
- New guard rules: `SELECT … INTO` is refused, and so are functions that act outside the transaction (`LOAD_FILE`,
  `pg_read_file`, `dblink*`, `set_config`, `pg_terminate_backend`, …). MySQL's `SET`, `LOCK`/`UNLOCK`, `HANDLER`,
  `LOAD DATA`, `PREPARE`/`EXECUTE`, `FLUSH`, `KILL`, `INSTALL PLUGIN` and `USE` are blocked by name. `REPLACE` is
  treated as a write, and `DESCRIBE` as a read.
- `art/demo-data-mysql.sql`, the screenshot database for MySQL and MariaDB.

### Fixed

- **Security: a guard bypass on PostgreSQL `write` connections.** The guard's regexes didn't know dollar-quoted
  (`$$…$$`) or `E'…'` strings, so a second statement could hide behind one. A write ran through `PDO::exec()`, which
  executed both statements, including DDL. The guard now lexes with each engine's own quoting rules, and every
  statement runs as a single server-side prepared statement, which neither engine will treat as a batch. Read-only
  connections were not affected, because the engine's READ ONLY transaction refused the write.
- `db-console:doctor` now reads `vite.config.ts` (and `.mjs`/`.mts`), and checks that the published page matches the
  app's language and is current.
- The toolbar pill shows the configured `label`.
- The connection menu grows to fit its longest name.
- Thai copy is complete in the sidebar, the CSV tooltip and the Structure tab.
- An empty table says it has no rows instead of "no row matches the filter".
- The guard message no longer repeats the keyword or adds the one-statement hint where it doesn't apply.
- `DELETE`, `INSERT`, `UPDATE` and DDL keywords are highlighted in the SQL editor.
- A complete SQL result no longer says "(sample)".
- A MySQL row update that saves the value already stored is no longer reported as "0 rows matched".

### Upgrading

Republish the page. The 1.0 page reads `document` during render, which fails under SSR, and it inherits the host's
default layout. The doctor flags an outdated page.

```bash
php artisan vendor:publish --tag=db-console-inertia --force
```

