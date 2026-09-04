# Introspection & data layer

`SchemaInspector` (`src/Support/SchemaInspector.php`) is the only thing that reads
the target database's structure. It builds two payloads with very different costs:
a **shallow tree** for the whole schema, shipped with the page, and **full
details** for one table at a time, fetched lazily. The split is the reason the
console opens in a fixed handful of queries no matter how large the schema is.

See also: [architecture](architecture.md) for where the payload flows,
[security model](security-model.md) for how the redactor filters what follows.

## Two payloads, two costs

**`tree()`** (line 44) returns, per configured schema, a list of
`{name, type, rowCount}` for every table and view — and nothing else. This is
deliberately shallow: columns, indexes, foreign keys and a row sample are ~six
queries and hundreds of KB **per object**, which on a 150-table database would be
~800 queries and megabytes of JSON before the viewer clicks anything.

**`details(schema, name)`** (line 58) returns one object in full: columns,
indexes, foreign keys, row count and the row sample. It asserts the schema is in
the connection's whitelist and the table isn't hidden, then reads `relkind` from
the catalog to decide `table` vs `view` (a materialised view counts as a view).
The frontend fetches this per table via `useTableDetails`
(`resources/js/db-console/useTableDetails.js`), cached per `schema.table` and
never fetched twice.

**`table(schema, name)`** (line 71) is a narrower read — columns + primary key
only — used by `RowWriter` to validate a row edit.

## Row-count estimation

Counting exactly is the expensive part, so counts come from the planner first and
fall back to `count(*)` only where the estimate is useless.

For the whole tree, `rowCounts()` (line 116) does at most two round trips:

1. `estimates()` (line 140) reads `pg_class.reltuples` for every relation in the
   schema in one catalog query. Postgres reports `-1` for a relation never
   analysed; those are floored to 0.
2. Tables whose estimate is 0 (never analysed, or genuinely empty) are collected
   and counted exactly in `exactCounts()` (line 163), which folds up to
   `COUNT_BATCH` (50) `count(*)` selects into a single `UNION ALL`.

Views are never counted — a view's count is the cost of running it — so they
report 0 in the tree.

For a single opened table, `rowCount()` (line 331) takes the `pg_class` estimate
when it is positive, returns 0 for a view, and otherwise runs one `count(*)`.

> [!NOTE]
> Tree row counts are estimates for anything analysed — the grid subtitle shows
> them with a `~`. They can lag the true count until the next ANALYZE/autovacuum.

## Column, index & FK metadata

Metadata comes from Laravel's schema builder (`getColumns`, `getIndexes`,
`getForeignKeys`), reshaped for the frontend in `object()` (line 224):

- **Columns** (`columns`, line 246): `{name, type, nullable, pk, fk, default,
  masked}`. `masked` (line 255) is `true` when the column matches a
  `masked_columns` glob — the grid uses it to keep the column out of the filter
  builder, and `RowReader` refuses to filter on it.
  `pk` is set by membership in the primary-key column list; `fk` is
  `foreign_table.foreign_column` from the first FK that starts on that column
  (`foreignKeyMap`, line 305); blank defaults are normalised to `null`.
- **Indexes** (`indexes`, line 268): each index's `type` is derived to one of
  `PRIMARY | UNIQUE | GIN | INDEX` (`indexType`, line 280).
- **Foreign keys** (`foreignKeys`, line 320): `{name, columns, references,
  onDelete, onUpdate}`, actions upper-cased. The grid and structure view use
  `references` to offer a jump to the referenced table.

## Sample rows

`sampleRows()` (line 346) reads the first `sample_rows` (default 100) rows via the
query builder, normalises binary/resource values to `"[binary]"`, then runs them
through the redactor's `maskRows`. This sample seeds the grid's first paint, but
the explorer grid no longer browses it client-side: as soon as the viewer filters,
sorts, or pages, `DataGrid` fetches a fresh slice from the `rows` endpoint, which
`RowReader` reads straight from the table (see
[the server-driven grid](architecture.md#server-driven-grid-rowreader)). So the
table view is a real, paginated browser over the whole table, not a sample
scanner. The SQL console is still the tool for arbitrary queries; its result grid
stays client-side over the in-memory result set.

`details()` also reports a `masked` boolean per column (`columns`, line 246 →
line 255), so the frontend can keep masked columns out of the filter builder —
they cannot be filtered on, matching the server whitelist in `RowReader`.

## Identifier quoting

The `public` schema stays unqualified so its queries are byte-for-byte the
pre-multi-schema ones (`qualify`, line 368). The one place a statement is built as
a string rather than through the builder — the batched `count(*)` — quotes
identifiers explicitly (`quoteQualified`, line 377).

## The console's own state tables

The tool's saved queries, run history, share links and favourites are **not** read
from the target connection — they live on the host app's default connection via
four Eloquent models, so the browsable connections stay read-only targets. All are
owner-scoped by the `ScopesToOwner` trait (`src/Support/ScopesToOwner.php`): the
authenticated user id when present, else the session id, with exactly one column
ever set.

| Table | Model | Store | Notes |
| --- | --- | --- | --- |
| `db_console_queries` | `SavedQuery` | `QueryStore::save/saved/forget` | Named queries, kept indefinitely. |
| `db_console_history` | `HistoryEntry` | `QueryStore::record/history` | Append-only; written for ok/rejected/error alike, outside the read transaction so a rolled-back read still leaves its row. |
| `db_console_shares` | `SharedQuery` | `QueryStore::share/resolveShare` | Token reopens the console with the same SQL; expired rows resolve to nothing until pruned. |
| `db_console_favorites` | `Favorite` | `FavoriteStore` | Starred `schema.table` per connection + owner. |

`db-console:prune` (`src/Console/PruneCommand.php`, scheduled daily) trims history
by age then to the newest `keep_rows` per owner, and clears expired shares. Saved
queries and favourites are never pruned. It deletes in explicit key batches
because Postgres has no `DELETE ... LIMIT`.

## Related files

- `src/Support/SchemaInspector.php` — all target-DB introspection.
- `src/Support/RowReader.php` — the grid's server-driven, paginated read (see [architecture](architecture.md#server-driven-grid-rowreader)).
- `resources/js/db-console/useTableDetails.js` — lazy per-table fetch + cache.
- `src/Support/QueryStore.php`, `src/Support/FavoriteStore.php`, `src/Support/ScopesToOwner.php` — console-owned state.
- `src/Models/{SavedQuery,HistoryEntry,SharedQuery,Favorite}.php` — the four state tables.
- `database/migrations/` — their schema.
- `src/Console/PruneCommand.php` — history/share retention.
