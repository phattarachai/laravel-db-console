# Security model

The console exposes a live database to a browser, so its safety is layered: an
authorization gate in front, a statement guard and a redactor around every query,
a two-request handshake before any write, and single-row constraints on grid
edits. No single layer is trusted alone.

See also: [architecture](architecture.md) for where each layer sits in the flow,
[introspection](introspection.md) for how the redactor filters the schema tree.

## Access gate

`Authorize` middleware (`src/Http/Middleware/Authorize.php`) is appended to the
route group by the provider, so it can't be removed by editing
`db-console.middleware`. It delegates to `DbConsole::check()`
(`src/DbConsole.php:37`):

- `local` environment is always allowed — the tool exists for debugging your own
  machine.
- Otherwise a `DbConsole::auth(fn ($request) => …)` callback decides, mirroring
  Horizon/Pulse registration.
- With no callback, it falls back to a `viewDbConsole` Gate when the app defined
  one; absent that, everyone but local is refused.

A rejected guest with a login route configured is redirected to it
(`redirect_guests_to`); a signed-in-but-refused user, an XHR, or an app with no
login route gets a plain 403. `db-console.enabled = false` unregisters the routes
entirely, so the console 404s rather than 403s — a true kill switch.

## Connection modes

A browsable connection is resolved from `config/db-console.php` by `Connection`
(`src/Support/Connection.php`), with the `defaults` block folded in. Only keys
listed under `connections` are reachable — adding one to `database.php` does not
expose it. PostgreSQL only: `db()` (line 77) throws `UnsupportedDriverException`
for any other driver.

`mode` is the core posture:

- **read** (default) — SELECT-family statements only, run inside a rolled-back
  `READ ONLY` transaction. Nothing can be written even if the guard were bypassed.
- **write** — additionally allows INSERT/UPDATE/DELETE/MERGE and grid row editing.

DDL is never allowed in either mode. `confirm_writes` decides whether a write on a
writable connection needs the type-to-confirm handshake first (a row **delete**
always confirms regardless).

## SqlGuard — statement classification

`SqlGuard::classify()` (`src/Support/SqlGuard.php:51`) is the enforcement point
for both the SQL console and EXPLAIN. It returns `read` or `write`, or throws
`SqlGuardException`. Steps, in order:

1. Strip string literals, quoted identifiers and comments so their contents can't
   smuggle a `;` or a keyword (`stripStringsAndComments`, line 138).
2. Reject empty input and any remaining `;` — **one statement per run**.
3. Read the first bareword keyword and classify it:
   - `READ_KEYWORDS` (`select, with, explain, show, table, values`) → `read`.
   - `DML_KEYWORDS` (`insert, update, delete, merge`) → `write`, but only on a
     writable connection; on a read connection it throws `guard.read_only`.
   - `BLOCKED_KEYWORDS` (DDL, session state, txn control: `drop, alter, create,
     truncate, grant, revoke, copy, call, do, vacuum, reindex, comment, lock,
     set, begin, commit, rollback, refresh`) → always rejected.
   - Anything else → `guard.unsupported`.
4. Scan every bare identifier against the hidden-table globs and refuse if any
   matches (`assertNoHiddenTable`, line 103).

> [!NOTE]
> The hidden-table scan is not a SQL parser: it checks every identifier-shaped
> token, so an alias or column that happens to match a hidden-table glob is
> refused too. A false positive is the deliberately safe direction.

`classifySql` in `resources/js/db-console/sql-lib.js:228` is an exact client-side
mirror — same keyword sets, same order, same message keys — but it is UX only
(disables Run, labels the chip). The server guard is the gate.

## SqlRunner — execution isolation

`SqlRunner` (`src/Support/SqlRunner.php`) runs the classified statement:

- A **read** runs inside a transaction with `SET TRANSACTION READ ONLY` and
  `SET LOCAL statement_timeout`, and is **always rolled back** (`runRead`, line
  86). Postgres itself refuses any write that slipped through.
- A **write** runs in a plain transaction that commits only if nothing threw
  (`runWrite`, line 118).
- **EXPLAIN** is always plain `EXPLAIN`, never `ANALYZE`, inside the same
  rolled-back READ ONLY transaction (`explain`, line 53) — the plan is computed,
  the statement never executes. Gated by `db-console.explain`.

Read results are capped at the connection's `max_rows`; a further available row
flips `truncated` (`rows`, line 182). Driver error prefixes are stripped so the
console shows just the message.

## Redactor — hidden tables & masked columns

`Redactor` (`src/Support/Redactor.php`) enforces two glob lists from config
(`hidden_tables`, `masked_columns`), matched case-insensitively via `Str::is`:

- **Hidden tables** are dropped from the schema tree (`SchemaInspector::inSchema`),
  refused by `assertVisible` on detail/row access, and rejected inside SQL by the
  guard.
- **Masked columns** have their value replaced with `***` (`Redactor::MASK`)
  before any row leaves the server — applied to sample rows, the grid's
  server-driven page reads (`RowReader`), SQL read results, and written-row echoes.
  A masked column also cannot be written by the row editor
  (`RowWriter::assertWritable`), nor **filtered or searched on** by the grid
  (`RowReader::filterableColumns`, `src/Support/RowReader.php:81`) — allowing an
  `eq`/`contains` probe on a masked column would leak the value the mask hides.

Both lists ship **empty**: a fresh install hides and masks nothing, including the
console's own `db_console_*` tables. See the commented examples in
`config/db-console.php` (line 108).

## Write handshake — ConfirmToken

`ConfirmToken` (`src/Support/ConfirmToken.php`) is the two-request handshake
behind a confirmed write. The first request returns 409 with a token + the exact
statement; the client replays the identical body with `confirm_token` once the
user types the confirmation word.

The token is a 32-char random string, cached for **60 seconds**, single-use
(`consume` forgets it, line 44), and its fingerprint binds `token | owner |
connection | sql` with SHA-256 and `hash_equals`. So a stale tab, a shared link,
an edited statement, or another user's token can never replay a confirmation. The
owner is the authenticated user id, or `session:<id>` for a guest install.

The controller decides when a handshake is required: `needsConfirmation()`
(`DbConsoleController.php:360`) for SQL writes on a `confirm_writes` connection,
and in `row()` a write when `confirmWrites` **or** the action is `delete`.

## RowWriter — single-row safety

`RowWriter` (`src/Support/RowWriter.php`) handles grid create/update/delete on a
writable connection. Its guarantees:

- **Writable connection only**, real table only (never a view), and the table
  must have a primary key (`assertWritable`, line 98).
- On update/delete the submitted `pk` keys must match the table's real primary key
  exactly; unknown columns and masked columns are rejected.
- Every statement is compiled through the query builder **with bindings**
  (`compile`, line 182) — never string-concatenated from request input.
- An update or delete that affects anything other than **exactly one row** throws
  `guard.affected_not_one` and rolls back (line 55): the grid edits one row, so a
  wider match means the primary key was wrong.
- Insert uses `returning *` to hand back the stored row (defaults/triggers
  included) in one round trip; the echoed row is run through the redactor.

The `preview()` statement shown in the confirm dialog interpolates bindings for
**display only** (`interpolate`, line 233) and is never executed.

## Production considerations

- Keep production connections `mode: read`. A read connection cannot write even
  through the SQL console, because the READ ONLY transaction is enforced by
  Postgres, not just the guard.
- If a write connection is genuinely needed, keep `confirm_writes` on so every
  write requires the typed handshake.
- Use `hidden_tables` / `masked_columns` to keep secrets (tokens, password hashes,
  PII) off the wire — masking happens server-side, so the value never reaches the
  browser at all.
- Share links sit behind the same middleware and gate as the console; they are a
  convenience for teammates who already have access, not a bypass
  (`config/db-console.php` share block).
- Point `DB_CONSOLE_ENABLED=false` to remove the routes entirely in environments
  where the console should not exist.

## Related files

- `src/Http/Middleware/Authorize.php`, `src/DbConsole.php` — the access gate.
- `src/Support/SqlGuard.php` — statement classification.
- `src/Support/SqlRunner.php` — transaction isolation, EXPLAIN.
- `src/Support/RowReader.php` — the grid's structured-filter reads: column/operator whitelist, bindings, same READ ONLY transaction.
- `src/Support/Redactor.php` — hidden tables & masked columns.
- `src/Support/ConfirmToken.php` — the write handshake.
- `src/Support/RowWriter.php` — single-row edit safety.
- `src/Support/Connection.php` — mode/driver resolution.
- `resources/js/db-console/sql-lib.js` — the client-side guard mirror.
- `lang/{en,th}/guard.php` — guard message copy.
