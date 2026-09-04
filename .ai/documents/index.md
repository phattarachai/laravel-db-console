# Documentation index

Maintainer-facing docs for `phattarachai/laravel-db-console` — an in-app web DB
client (browse PostgreSQL tables, run guarded SQL) built on Inertia v3 + React 19.
Read the doc whose topic matches what you are about to change before you change it.

## Architecture

- [Architecture overview](architecture.md) — request/data flow end to end
  (browser → Inertia page → controller → SchemaInspector/SqlRunner/RowReader →
  payload → React module), the two views (table browsing vs SQL console), the
  self-contained plain-CSS styling model, the server-driven grid (RowReader +
  filter contract + `hasMore` pagination + URL persistence), and the module map.
- [Security model](security-model.md) — read-only-by-default posture, connection
  modes, the SqlGuard, the Redactor, the confirm-token write handshake, RowWriter's
  single-row safety, and production considerations.
- [Introspection & data layer](introspection.md) — how SchemaInspector builds the
  shallow tree vs the lazy per-table details, row-count estimation, the seed sample
  vs the server-driven grid reads, and where column/index/FK metadata comes from.
