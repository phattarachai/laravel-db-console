# Architecture overview

The package is a single-page DB client mounted inside a host Laravel app. One
Inertia page (`DbConsole`) renders a self-contained React module; every server
interaction after the first load is a plain `fetch` to a package route. The React
module knows no Laravel routes — endpoint URLs, brand, feature flags and copy all
arrive as props, so the frontend folder is drop-in portable.

Companion docs: [security model](security-model.md) for the guard/redaction/write
layers, [introspection](introspection.md) for how the schema payload is built.

## Boot & wiring

`DbConsoleServiceProvider` (`src/DbConsoleServiceProvider.php`) merges config,
loads translations + migrations, and — when `db-console.enabled` — registers the
route group (`registerRoutes()`, line 40) under `db-console.path` with the host's
`middleware` plus `ApplyLocale` and `Authorize` **appended** so the gate can't be
dropped by editing config. In console context it also registers publishing tags,
the two commands, and a daily `db-console:prune` schedule.

The only file published into the host tree is the Inertia page
(`resources/js/pages/DbConsole.jsx`); the module itself is reached through a
`@db-console` Vite alias, so there is no second copy to drift. See the publish
tags in `registerPublishing()` (line 50).

## Request / data flow

```
Browser
  │  GET /db-console                 (Inertia visit)
  ▼
DbConsoleController::index ──► payload() ──► Inertia::render('DbConsole', …)
  │        builds: connections, active connection, endpoint URLs, brand,
  │        strings, feature flags, saved/history, SchemaInspector::tree()
  ▼
resources/js/pages/DbConsole.jsx  (reads csrf meta) ──► <DbConsole {...props}/>
  ▼
resources/js/db-console/DbConsole.jsx  (the module root)
  │
  ├─ table selected ──► GET  endpoints.table  ──► controller::table
  │                       └► SchemaInspector::details()  (columns/idx/fk/rowsample)
  ├─ grid page/filter► POST endpoints.rows   ──► controller::rows
  │                       └► RowReader::page()  (filtered/sorted, paginated)
  ├─ SQL run       ──► POST endpoints.query  ──► controller::query
  │                       └► SqlRunner::run()  (guarded, in a txn)
  ├─ EXPLAIN       ──► POST endpoints.explain ──► SqlRunner::explain()
  ├─ row edit      ──► POST endpoints.row     ──► RowWriter::apply()
  ├─ favourite     ──► POST endpoints.favorite──► FavoriteStore::toggle()
  └─ save / share  ──► POST endpoints.saved / share ──► QueryStore
```

The initial Inertia payload is assembled in `DbConsoleController::payload()`
(`src/Http/Controllers/DbConsoleController.php:268`). It carries the **shallow**
schema tree only; a table's columns, indexes and FKs are fetched lazily per table
via `endpoints.table`, and the grid's actual rows come from `endpoints.rows`
(`RowReader`) a page at a time — see [introspection](introspection.md) and
[the server-driven grid](#server-driven-grid-rowreader) below. Endpoint URLs are
resolved server-side with `route()` and handed to the page under `endpoints`
(line 276) — the JS never builds a URL from a route name.

Every JSON call from the module goes through `sendJson()`
(`resources/js/db-console/lib.js:287`), which never throws on non-2xx: callers
branch on `status` (409 = confirmation handshake, 422 = guard/DB rejection with a
localised `message`). Table detail loads through `useTableDetails`
(`resources/js/db-console/useTableDetails.js`), which caches per `schema.table`
and never re-fetches a settled or in-flight key.

## The two views

The toolbar toggles one connection between two mutually exclusive main-area
views; the sidebar tree is shared by both.

**Table browsing (`explorer`).** Selecting a table in `Sidebar` sets `selected`
in `DbConsole.jsx`; an effect loads its structure (columns/indexes/FKs) and
`DataGrid` renders a Structure/Data switch. In this view the grid is
**server-driven**: it is handed a `source` prop and POSTs to `endpoints.rows`
whenever the filters, quick search, sort, page or page size change, so the data is
a real slice of the whole table, not a client-side slice of a sample (see
[the server-driven grid](#server-driven-grid-rowreader)). Filtering is an
Adminer-style per-field builder (`FilterBar.jsx` + `filter-lib.js`), and the whole
view state is mirrored onto the URL query string so a refresh or shared link
restores it. This path is read-first but grows row editing when the connection is
writable (`features.rowEdit`) — a `New row` button and edit/delete entries in the
right-click cell menu, driven by `RowForm`.

**SQL console (`sql`).** `SqlConsole` owns an editor plus tabbed
results/plan/saved/history. Run POSTs the raw statement to `endpoints.query`;
the server classifies and runs it. `classifySql` (`sql-lib.js`) is a client-side
mirror of the server guard — it disables Run and labels the chip, but the server
is the real gate. A write on a `confirm_writes` connection comes back 409 with a
single-use token, which the type-to-confirm panel replays. The SQL result grid
reuses `DataGrid` with no `rowEditing` **and no `source`**, so it stays in the
grid's client-side mode over the in-memory result set — query results stay
strictly read-only and are never re-fetched from the server.

Mode is URL-backed (`?mode=sql`) via `readConsoleMode`/`writeConsoleMode`
(`lib.js:256`), so a refresh or a shared link restores the view. The explorer
grid persists its own view state on the same URL (`?table=&q=&filters=&sort=&page=
&perPage=`) via `updateUrlState`/`readUrlState` (`lib.js:306`, `lib.js:318`).
Switching connection is a full page load (`?conn=<key>`), not a patch — see
`ConnectionPicker.jsx`.

## Module map (`resources/js/db-console/`)

| File | Owns |
| --- | --- |
| `index.js` | Public exports: `DbConsole`, strings context. |
| `DbConsole.jsx` | Module root — toolbar, scheme toggle, mode switch, fatal state; wires sidebar + main area; holds `selected`, favourites, `useTableDetails`. |
| `Sidebar.jsx` | Schema→table/view tree, name filter, favourites-only filter, per-table lazy column list, double-click-to-insert in SQL mode. |
| `DataGrid.jsx` | Dual-mode grid. **Server-driven** when given a `source` prop (the explorer): POSTs to `endpoints.rows` for a filtered/sorted/paged slice, `hasMore` next/prev, view state on the URL. **Client-side** without it (SQL results): filter/sort/paginate over the in-memory rows. Both share sticky sortable header, typed cell rendering, FK jump, CSV export, column resize, right-click cell menu; hosts row editing when enabled. |
| `FilterBar.jsx` | The Adminer-style per-field filter builder — exports `FilterAddButton` (the `+ filter` trigger + column menu in the toolbar) and `FilterConditions` (the row of active conditions + clear-all under the header). Masked columns are never offered. |
| `filter-lib.js` | Maps a column's Postgres type to its available operators and value-input shape (`operatorsFor`, `valueShapeFor`), and reduces the builder's working conditions to the `{column, operator, value}` wire payload `RowReader` expects (`toPayload`). UX only — the server re-whitelists. |
| `TableStructure.jsx` | The Structure tab — columns/indexes/foreign keys tables. |
| `CellDrawer.jsx` | Side inspector for one cell; JSON pretty/raw with a local highlighter. |
| `RowForm.jsx` | Create/update/delete modal; typed fields, null toggle, changed-only payload, in-form confirm gate. |
| `SqlConsole.jsx` | SQL mode shell: run/explain/share/save, result/plan/saved/history tabs, 409 confirm panel. |
| `SqlEditor.jsx` | Zero-dep editor: highlighted `<pre>` behind a transparent `<textarea>`, gutter, `insertText` via ref. |
| `ConnectionPicker.jsx` | Toolbar connection pill + multi-connection dropdown (switch = full reload). |
| `useTableDetails.js` | Lazy, cached per-table detail fetching. |
| `lib.js` | Dependency-free helpers: `cx`, cell classification, CSV, `sendJson`, localStorage prefs (scheme, favourites-only, column widths), URL console mode, and the generic query-string state helpers `readUrlState`/`updateUrlState` the explorer grid persists its view through. |
| `sql-lib.js` | SQL tokenizer, light formatter, and `classifySql` (client mirror of `SqlGuard`). |
| `strings.js` | Flat dotted-key English defaults + `useStrings`/`translate`; host overrides via the `strings` prop (same shape as `lang/{locale}/ui.php`). |
| `icons.jsx` | Shared SVG glyphs (grid-local copy/gear icons live in `DataGrid.jsx`). |

## Styling

The module ships **self-contained plain CSS** — no Tailwind, no host build-tool
coupling, so a host app drops the package in without touching its own CSS
pipeline. All of it lives in **one hand-written file**,
`resources/js/db-console/db-console.css` (~2900 lines), scoped under `.dc-root`,
and `DbConsole.jsx` imports **only** it (`import './db-console.css'`,
`DbConsole.jsx:14`) — there is no `partials/` directory and no CSS `@import`.

The file is organised top to bottom as: the `--dc-*` theme tokens on `.dc-root`
(the header comment), their dark overrides (`.dark .dc-root:not(.light)` and
`.dc-root.dark`), a small **base + primitives** block, then one section per
component — each rule prefixed with the component's own class family
(`dc-shell-`/`dc-top-`, `dc-side-`, `dc-grid-`, `dc-struct-`, `dc-sql-`, plus
`RowForm`/`CellDrawer`/`ConnectionPicker` blocks) — a `Responsive` block, and the
**FilterBar rules appended last** (`dc-grid-filterbar` / `dc-filter-*`). There is
no cascade-layer reset — no `@layer`. The primitives are a small set of shared
atoms (`dc-btn` with a `.primary` modifier, `dc-iconbtn`, `dc-pill` with `.round`,
`dc-input`, and the `dc-row`/`dc-cell` flex atoms); boolean state is a modifier
word appended in the JSX (e.g. `dc-btn primary`), and component structure composes
these under its own semantic classes.

Re-skinning is a matter of overriding a token on `.dc-root` or a parent;
`brand.accent` sets `--dc-accent` (`DbConsole.jsx:261`), the token everything else
derives from.

## Server-driven grid (RowReader)

In the explorer, table browsing is a real server-side read, not a client scan of a
sample. `DataGrid` is server-driven whenever it is handed a `source`
(`{endpoint, csrfToken, connectionKey, schema}`); `DbConsole.jsx` passes one only
for the explorer grid (`DbConsole.jsx:381`), never for SQL results. On any change
to the applied filters, quick search, sort, page or page size it POSTs to
`endpoints.rows` (`DataGrid.jsx:374`, debounced at `DataGrid.jsx:360`).

`DbConsoleController::rows()` (`src/Http/Controllers/DbConsoleController.php:83`)
validates the request and hands it to `RowReader::page()`
(`src/Support/RowReader.php:56`). The **filter contract** is structured, never
typed SQL:

- Each condition is `{column, operator, value}`; the whole set is ANDed.
- Operators are a fixed set (`RowReader.php:35-41`): scalar `eq / ne / lt / lte /
  gt / gte / contains / starts / ends`, list `in / nin`, `between`, and the
  value-less `is_null / not_null / is_true / is_false`. `contains/starts/ends` are
  `ILIKE` with the term's `%`/`_` escaped (`escapeLike`, `RowReader.php:321`).
- The `search` string is a single `ILIKE` ORed across every text column
  (`applySearch`, `RowReader.php:183`), wrapped so it ANDs with the filters.
- `sort` is `{column, dir}`, always followed by the primary key for a stable order
  (`applySort`, `RowReader.php:211`).

Everything is **whitelisted server-side**: the column against the table's real,
**non-masked** columns (`filterableColumns`, `RowReader.php:81`) and the operator
against the fixed set (`assertOperator`, `RowReader.php:276`) — masked columns
cannot be filtered on, so their values can't be recovered by probing, the same
line `RowWriter` draws for writes. Every condition compiles through the query
builder **with bindings**, and the read runs inside the same always-rolled-back
`READ ONLY` transaction as `SqlRunner` (`read`, `RowReader.php:230`), so Postgres
itself refuses a write that slipped through.

Pagination is **"one more than asked"**: the reader offsets by page and fetches
`perPage + 1` rows, reporting `hasMore` from the overflow and slicing back to
`perPage` before masking (`RowReader.php:234`, `243`) — it never counts the whole
table, so a filter over a huge table costs a page, not a scan. `perPage` is
clamped to `min(200, connection.maxRows)` (`clampPerPage`, `RowReader.php:331`).
The grid renders exactly the returned page and drives prev/next off `hasMore`
rather than a total count. The whole view state (`table`, `q`, `filters`, `sort`,
`page`, `perPage`) is mirrored onto the URL so a refresh or shared link restores
it — written by `updateUrlState` (`DataGrid.jsx:428`) and rehydrated on mount by
`readGridStateFromUrl` (`DataGrid.jsx:47`), re-deriving each filter's type from the
live columns.

`SchemaInspector::columns()` now carries a `masked` boolean per column
(`SchemaInspector.php:255`), which the builder reads to hide masked columns from
the filter menu (`DataGrid.jsx:353`).

## Related files

- `src/Http/Controllers/DbConsoleController.php` — every endpoint.
- `routes/web.php` — route names the payload resolves.
- `config/db-console.php` — connections, safety lists, feature flags, branding.
- `src/DbConsoleServiceProvider.php` — boot, route group, publishing, schedule.
- `resources/js/pages/DbConsole.jsx` — the published Inertia page (Laravel seam).
- `src/Support/RowReader.php` — the server-driven grid read (filters/sort/pagination).
- `resources/js/db-console/FilterBar.jsx`, `filter-lib.js` — the filter builder + its type→operator map.
- `resources/js/db-console/db-console.css` — the single self-contained stylesheet (scoped `.dc-root`, `--dc-*` tokens, primitives + per-component sections, FilterBar rules appended).
- `src/Console/DoctorCommand.php` — install checks (driver, migrations, routes, published page, Vite alias — no Tailwind wiring).
