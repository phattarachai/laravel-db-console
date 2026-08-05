# Laravel DB Console

[![Latest Version on Packagist](https://img.shields.io/packagist/v/phattarachai/laravel-db-console.svg?style=flat-square)](https://packagist.org/packages/phattarachai/laravel-db-console)
[![Tests](https://img.shields.io/github/actions/workflow/status/phattarachai/laravel-db-console/run-tests.yml?branch=main&label=tests&style=flat-square)](https://github.com/phattarachai/laravel-db-console/actions/workflows/run-tests.yml?query=branch%3Amain)
[![Code Style](https://img.shields.io/github/actions/workflow/status/phattarachai/laravel-db-console/fix-php-code-style-issues.yml?branch=main&label=code%20style&style=flat-square)](https://github.com/phattarachai/laravel-db-console/actions/workflows/fix-php-code-style-issues.yml?query=branch%3Amain)
[![PHP Version](https://img.shields.io/packagist/dependency-v/phattarachai/laravel-db-console/php?style=flat-square&label=php&logo=php&logoColor=white)](https://packagist.org/packages/phattarachai/laravel-db-console)
![Laravel Version](https://img.shields.io/badge/laravel-12%20%7C%2013-FF2D20?style=flat-square&logo=laravel&logoColor=white)
[![Total Downloads](https://img.shields.io/packagist/dt/phattarachai/laravel-db-console.svg?style=flat-square)](https://packagist.org/packages/phattarachai/laravel-db-console)

An in-app web DB client for Laravel — browse your tables and run guarded SQL in the browser, instead of installing
Adminer next to every project.

Read-only by default. Writes are opt-in per connection, a row delete always asks before it runs, and **DDL is never
allowed in any mode**.

![The explorer: schema tree, resizable columns, live data](https://raw.githubusercontent.com/phattarachai/laravel-db-console/main/art/explorer.png)

<details>
<summary><b>More screenshots</b> — SQL console, dark scheme</summary>

**SQL console** — editor with highlighting and a formatter, a read/write guard chip, results with row count and elapsed
time, saved queries, run history, EXPLAIN, and a share link.

![The SQL console with a query and its results](https://raw.githubusercontent.com/phattarachai/laravel-db-console/main/art/sql-console.png)

**Dark scheme** — `brand.scheme` set to `dark`; `auto` follows a `.dark` ancestor class from the host app.

![The same explorer in the dark scheme](https://raw.githubusercontent.com/phattarachai/laravel-db-console/main/art/dark.png)

</details>

<sub>Every screenshot runs against the fictional demo database in
[`art/demo-data.sql`](art/demo-data.sql) — no real company or person appears in them.</sub>

## Requirements — read these first

This package is deliberately narrow. If any of these do not hold, it will not work, and it says so rather than
half-working:

- **PostgreSQL only.** A non-`pgsql` connection fails with a message naming the connection and its driver. MySQL/SQLite
  are not supported.
- **Inertia v3 + React 19** in the host app. The console is an Inertia page, not a Blade view.
- **Tailwind v4 with the `tw` prefix.** The module's markup uses `tw:`-prefixed utilities, so the host must
  `@import 'tailwindcss' prefix(tw);` and `@source` the package's JSX.
- The host app **builds its own assets** — nothing is precompiled or published as a bundle.
- PHP 8.4+, Laravel 11/12/13.

Run `php artisan db-console:doctor` at any point: it checks the driver, the migrations, the routes, the published page,
the Vite alias and both Tailwind requirements, and tells you exactly which one is missing.

## Install

```bash
composer require phattarachai/laravel-db-console
php artisan vendor:publish --tag=db-console-config
php artisan vendor:publish --tag=db-console-inertia
php artisan migrate
```

Then wire the two build-tool bits. In `vite.config.js`:

```js
import path from 'node:path'

export default defineConfig({
    resolve: {
        alias: {
            '@db-console': path.resolve(
                __dirname,
                'vendor/phattarachai/laravel-db-console/resources/js/db-console',
            ),
        },
    },
})
```

In your Tailwind entry CSS:

```css
@import 'tailwindcss' prefix(tw);
@source '../../vendor/phattarachai/laravel-db-console/resources/js/**/*.jsx';
@custom-variant dark (&:where(.dark, .dark *));
```

Then `npm run build`, and open `/db-console`.

Only the Inertia **page** is published, into `resources/js/pages/DbConsole.jsx` — Laravel's
`import.meta.glob('./pages/**/*.jsx')` never leaves that directory. The module itself stays in `vendor/` and is reached
through the alias, so there is no second copy to drift out of sync.

### Why the `tw` prefix is mandatory

Every utility class in the module is written `tw:flex`, `tw:text-sm`, and so on. Tailwind v4 only understands that
form when the entry CSS declares `prefix(tw)`. A host on the default (prefix-less) setup will render the console
completely unstyled. There is no compiled-CSS fallback — that was considered and declined, because a prebuilt
stylesheet cannot follow your theme tokens. `db-console:doctor` checks both the `prefix(tw)` declaration and the
`@source` line.

## Access

`local` is always open — the console's whole point is being there while you debug your own machine. Everywhere else,
declare who may open it, in a service provider:

```php
use Phattarachai\DbConsole\DbConsole;

DbConsole::auth(fn (Request $request) => $request->user()?->isAdmin() === true);
```

With no callback registered it falls back to a `viewDbConsole` gate if the app defines one, and denies otherwise. The
`Authorize` middleware is appended by the service provider, so it cannot be dropped by editing `db-console.middleware`.

A **guest** who is denied is redirected to `redirect_guests_to` (default: the `login` route) with the intended URL
remembered, so signing in lands them back on the console. A signed-in user the gate rejects gets a plain `403` — no
point sending them to a form they already passed — and so does any XHR.

Kill it entirely with `DB_CONSOLE_ENABLED=false`: no routes are registered at all, so the paths 404 rather than 403.

## What it does

**Explorer** — schema tree with a filter, per-table **Structure** (columns with types, nullability, defaults, indexes,
foreign keys) and **Data** tabs, sortable and filterable grid, foreign-key jump-to-referenced-row, CSV export of the
current view. Columns are **drag-resizable from their right edge** (double-click a handle to reset), and the widths are
remembered per table in the browser. A **View** menu toggles the column-type line on and off.

**The value panel** — double-click any cell to open a side panel with the full value, pretty-printed and
syntax-highlighted for `json` / `jsonb`, with a Raw toggle. The panel is resizable and remembers its width.

**Right-click any cell** for everything else: inspect the value, jump to the referenced row when the column is a
foreign key, copy the value, copy the whole row as JSON or as plain text, and — on a `write` connection — edit or
delete the row. There is no actions column stealing horizontal space.

**SQL console** — editor with highlighting, a formatter, a read/write guard chip that updates as you type, result
grid, EXPLAIN, saved queries, run history, and a copyable share link.

**Row editing** — on a `write` connection only. The generated SQL is shown before it runs. **Delete always asks for a
typed confirmation**, whatever `confirm_writes` says, because it is one irreversible click; insert and update follow
`confirm_writes`. Tables without a primary key stay read-only, and masked columns can never be written.

**Multiple connections** — list more than one in `connections` and a picker appears in the toolbar, each with its own
mode badge. A read-only connection sits next to a writable one without either being able to affect the other.

## Safety model

![A DELETE rejected by the guard on a read-only connection](https://raw.githubusercontent.com/phattarachai/laravel-db-console/main/art/sql-guard.png)

Layered, so no single check is load-bearing:

1. **Client guard** — instant feedback while typing. UX only, never the enforcement.
2. **App guard** — strings and comments stripped, one statement per run, first keyword checked against read / DML /
   blocked sets. DDL, session and transaction keywords are blocked in every mode. Any identifier matching
   `hidden_tables` refuses the statement.
3. **Engine** — a `read` statement runs inside `SET TRANSACTION READ ONLY` with a `statement_timeout`, and the
   transaction is **always rolled back**. Postgres rejects a write that slips past the keyword guard
   (`SELECT nextval(...)`, for instance).
4. **Confirmation** — with `confirm_writes` on (or for any row delete), a write answers `409` with a single-use token
   bound to the exact SQL. Editing the statement by one character invalidates it.
5. **Row cap** — results stop at `max_rows`; one further available row sets `truncated`.

`hidden_tables` and `masked_columns` both ship **empty** — the console shows your database as it is until you say
otherwise, including its own `db_console_*` tables. When you do set `masked_columns`, matches are replaced with `***`
**server-side**, so the secret never reaches the browser.

## Configuration

See [`config/db-console.php`](config/db-console.php) — every key is documented inline. The essentials:

| Key                                | Default             | Notes                                             |
|------------------------------------|---------------------|---------------------------------------------------|
| `enabled`                          | `true`              | `false` registers no routes                       |
| `path` / `domain`                  | `db-console`        | where it mounts                                   |
| `middleware`                       | `['web']`           | `Authorize` is always appended                    |
| `redirect_guests_to`               | `login`             | route name or URL; `null` 403s guests instead     |
| `defaults.mode`                    | `read`              | `read` or `write`, per connection                 |
| `defaults.confirm_writes`          | `false`             | typed confirmation; a row delete always asks      |
| `defaults.max_rows` / `timeout`    | `5000` / `5000`     | rows, milliseconds                                |
| `connections`                      | `['default' => []]` | only what is listed is reachable                  |
| `hidden_tables` / `masked_columns` | empty               | glob patterns; nothing hidden or masked until set |
| `history.keep_days` / `keep_rows`  | `30` / `500`        | pruned by `db-console:prune`                      |
| `share.expires_days`               | `7`                 | `null` never expires                              |
| `brand.name` / `url`               | `APP_NAME` / `/`    | the toolbar logo links back to your app           |
| `brand.accent` / `scheme`          | `#e11d2f` / `auto`  | injected as `--dc-accent`                         |
| `locale`                           | app locale          | `en` and `th` ship                                |

A second connection is two lines:

```php
'connections' => [
    'default' => [],
    'reporting' => ['mode' => 'read', 'label' => 'Reporting replica'],
],
```

## Commands

```bash
php artisan db-console:doctor   # eight install checks, each with the fix
php artisan db-console:prune    # trim history and expired share links
```

`prune` deletes history past `keep_days`, trims each owner to the newest `keep_rows`, and drops expired share links.
Saved queries are never pruned. The package schedules it daily while `history.store` is `database`.

## Theming

`brand.accent` is injected inline, so rebranding needs no rebuild. Everything else is a CSS custom property you can
override:

```css
.dc-root {
    --dc-bg: #0b0d10;
    --dc-accent: #16a34a;
}
```

Dark mode follows a `.dark` ancestor class, matching the Tailwind convention. `brand.scheme` may be `light`, `dark`, or
`auto` to follow the host — but it is only the **default**: a toolbar button cycles light → dark → auto and remembers
the viewer's choice in `localStorage`, so the theme is a preference of that browser rather than of the installation.
`light` wins even inside a host app that is itself dark.

## Translations

Copy lives in `lang/{en,th}/ui.php` (the browser strings, handed to React as one `strings` prop) and
`lang/{en,th}/guard.php` (the server's rejection messages). Publish and edit them:

```bash
php artisan vendor:publish --tag=db-console-lang
```

The React module ships English defaults, so it renders standalone even with no lang files at all. Adding a locale means
adding one directory — no JavaScript changes.

## Contributing

```bash
git clone git@github.com:phattarachai/laravel-db-console.git
cd laravel-db-console
composer install
createdb db_console_testing          # PostgreSQL, empty; the suite builds the schema
composer test
```

The suite runs against a **real PostgreSQL database** — the console's guarantees are engine-level
(`SET TRANSACTION READ ONLY`, `statement_timeout`, `pg_class` introspection), so an SQLite stand-in would prove
nothing. Override the connection with the usual `DB_*` env vars, or copy `phpunit.xml.dist` to `phpunit.xml` and edit
it there.

The tests own their schema: `tests/database/migrations/` creates `dc_users`, `dc_owners`, `dc_items` and `dc_hidden`,
which exist purely to exercise primary keys, foreign keys with `on delete cascade`, column masking and the
`hidden_tables` filter.

## Licence

MIT.
