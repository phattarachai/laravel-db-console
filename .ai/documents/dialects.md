# Database dialects

The console runs on PostgreSQL, MySQL 8 and MariaDB. Almost everything goes
through Laravel's query and schema builders, which already speak all three; what
they don't cover lives in two places.

See also: [security model](security-model.md) for why each engine-level guarantee
matters, [introspection](introspection.md) for the payloads the dialect feeds.

## Where the differences live

- **`SqlLexer`** (`src/Support/SqlLexer.php`) — how literals, quoted identifiers and
  comments end. Picked from the connection's *configured driver*
  (`Connection::lexerDialect()`), so classifying never connects. MySQL and MariaDB
  share one set of rules (`/*M! … */` is MariaDB's spelling).
- **`Dialect`** (`src/Support/Dialects/`) — everything that needs a live
  connection: `PostgresDialect`, and `MySqlDialect` with a `maria` flag
  (`Dialect::for()` asks Laravel's `isMaria()`, because MariaDB is often reached
  through the `mysql` driver). `Connection::dialect()` memoises it.

| Concern | `Dialect` method | PostgreSQL | MySQL | MariaDB |
|---|---|---|---|---|
| Read-only transaction | `read()` | `SET TRANSACTION READ ONLY` inside | same, *before* `BEGIN`; refuses inside an open transaction | as MySQL |
| Read timeout | `read()` | `SET LOCAL statement_timeout` | session `max_execution_time` (ms), restored | session `max_statement_time` (s), restored |
| Write timeout | `write()` | `SET LOCAL statement_timeout` | session `innodb_lock_wait_timeout` (s) — lock waits only | `max_statement_time` |
| One statement only | `prepare()` | `PQexecParams` (disable prepares) | server-side prepare (emulation off) | as MySQL |
| Row estimates | `estimates()`, `rowEstimate()` | `pg_class.reltuples` | `information_schema.tables.table_rows` | as MySQL |
| Object kind | `kindOf()` | `pg_class.relkind` (`v`/`m` = view) | `information_schema.tables.table_type` | as MySQL |
| EXPLAIN | `explain()` | `EXPLAIN` lines | `EXPLAIN FORMAT=TREE`, split on newlines | `EXPLAIN` table laid out as text |
| Text match | `caseInsensitiveMatch()` | `col::text ilike` | `col like` (collation decides case) | as MySQL |
| `RETURNING *` | `supportsReturning()` | yes | no — insert, then select by PK / `lastInsertId()` | no (same path) |
| Default schema | `defaultSchema()` | `public` | the connection's database | as MySQL |
| Result column types | `displayType()` | `int4` → `integer`, … | `LONGLONG` → `bigint`, … | as MySQL |

Two MySQL behaviours the writers handle outside the dialect table:

- **Rows changed, not matched.** MySQL's affected-row count for an `UPDATE` that
  stores the value already there is 0. `RowWriter::change()` counts the PK match
  instead, so that isn't reported as `affected_not_one`.
- **`schemas` are databases.** `Connection::schemas()` defaults to the connection's
  database and reads a listed `public` as that database, so a config published
  before 1.1 keeps working on MySQL.

LIKE patterns use an explicit `ESCAPE '!'` (`RowReader::whereLike()`): both engines
default to a backslash escape, but MySQL drops it under `NO_BACKSLASH_ESCAPES`.

## Testing on every engine

`DB_CONNECTION` picks the engine (`pgsql` default, `mysql`, `mariadb`;
`tests/Pest.php` → `dcDriver()`). Helpers keep tests engine-neutral: `dcSchema()`
(`public` or the database), `dcWriteProbeSql()` (Postgres `nextval`, MySQL the
fixture function `dc_write_probe()` that inserts a row), `dcForeignTable()`.

Postgres runs each test inside `RefreshDatabase`'s transaction. MySQL can't — the
console's `SET TRANSACTION READ ONLY` is refused inside an open transaction — so
MySQL tests use `DatabaseTruncation`, with the fixture migrations joined to its
`migrate:fresh` (`TestCase::defineDatabaseMigrations()`).

CI (`.github/workflows/run-tests.yml`) runs one service container per job, its
image chosen by the matrix: `postgres:17`, `mysql:8.4`, `mariadb:11.4`. MariaDB is
covered by CI only on a machine without it.

## Related files

- `src/Support/Dialects/{Dialect,PostgresDialect,MySqlDialect}.php`
- `src/Support/SqlLexer.php`, `resources/js/db-console/sql-lib.js` (`lexSql`)
- `src/Support/Connection.php` — `DRIVERS`, `dialect()`, `lexerDialect()`, `schemas()`
- `tests/Feature/EngineSafetyTest.php`, `tests/Unit/SqlGuardTest.php`
