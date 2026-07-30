<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Kill switch
    |--------------------------------------------------------------------------
    |
    | When false, no routes are registered at all — the console 404s rather
    | than 403s. Nothing about the tool is reachable.
    |
    */

    'enabled' => env('DB_CONSOLE_ENABLED', default: true),

    /*
    |--------------------------------------------------------------------------
    | Routing
    |--------------------------------------------------------------------------
    */

    'path' => env('DB_CONSOLE_PATH', 'db-console'),

    'domain' => env('DB_CONSOLE_DOMAIN'),

    /*
    | The Authorize middleware is always appended by the service provider, so
    | the gate can never be forgotten by editing this list.
    */
    'middleware' => ['web'],

    /*
    | Where a *guest* is sent when the gate says no. A route name (preferred) or
    | a URL; the intended URL is remembered, so logging in lands back on the
    | console. null 403s instead, and so does an already-signed-in user who the
    | gate still rejects — sending them to a login form they already passed
    | would only loop. Unknown route name also falls through to 403.
    */
    'redirect_guests_to' => env('DB_CONSOLE_LOGIN_ROUTE', 'login'),

    /*
    |--------------------------------------------------------------------------
    | Connection defaults
    |--------------------------------------------------------------------------
    |
    | Applied to every entry in `connections`, so a per-connection override
    | only names what differs.
    |
    | mode  read  — SELECT family only, run inside a rolled-back READ ONLY
    |               transaction. Nothing can be written.
    |       write — additionally allows INSERT / UPDATE / DELETE and row
    |               editing in the grid. DDL is never allowed, in any mode.
    |
    | confirm_writes  false (default) — a write runs on the first request, with
    |                 no typed confirmation. The one exception is a row delete,
    |                 which always asks: it is irreversible and a single click.
    |                 true — every write needs the confirmation handshake first.
    |
    */

    'defaults' => [
        'mode' => 'read',
        'label' => null,
        'schemas' => ['public'],
        'max_rows' => 5000,
        'timeout' => 5000,
        'sample_rows' => 100,
        'confirm_writes' => false,
    ],

    /*
    |--------------------------------------------------------------------------
    | Browsable connections
    |--------------------------------------------------------------------------
    |
    | Keys are the connection names from config/database.php. The special key
    | "default" resolves to config('database.default'). Only the connections
    | listed here are reachable — adding one to database.php does not expose it.
    |
    | PostgreSQL only: any other driver fails loudly with a readable message.
    |
    */

    'connections' => [
        'default' => [],
    ],

    /*
    |--------------------------------------------------------------------------
    | Safety
    |--------------------------------------------------------------------------
    |
    | Both lists accept glob patterns. Hidden tables are removed from the tree
    | and rejected in SQL; masked columns are replaced with "***" server-side,
    | so the value never reaches the browser.
    |
    | Both ship EMPTY: a fresh install hides nothing and masks nothing. The
    | entries below are examples — uncomment the ones you want. Leaving
    | 'db_console_*' commented means the console lists its own
    | db_console_queries / db_console_history / db_console_shares tables as
    | browsable data like any other table.
    |
    */

    'hidden_tables' => [
        // 'db_console_*',
        // 'sessions',
        // 'password_reset_tokens',
        // 'oauth_*',
    ],

    'masked_columns' => [
        // 'password',
        // '*_token',
        // '*_secret',
        // 'api_key',
    ],

    /*
    |--------------------------------------------------------------------------
    | Saved queries + run history
    |--------------------------------------------------------------------------
    |
    | Saved queries are kept indefinitely. History is pruned by age and then
    | trimmed to the newest `keep_rows` per owner by `db-console:prune`, which
    | the package schedules daily.
    |
    */

    'history' => [
        'store' => 'database',
        'keep_days' => 30,
        'keep_rows' => 500,
    ],

    /*
    |--------------------------------------------------------------------------
    | Shareable links
    |--------------------------------------------------------------------------
    |
    | Copy a link that reopens the console with the same SQL. Share links sit
    | behind the same middleware and gate as the rest of the console — they are
    | a convenience for teammates who already have access, not a bypass.
    |
    | expires_days: null keeps links forever.
    |
    */

    'share' => [
        'enabled' => true,
        'driver' => 'token',
        'expires_days' => 7,
    ],

    /*
    |--------------------------------------------------------------------------
    | EXPLAIN
    |--------------------------------------------------------------------------
    |
    | Adds an EXPLAIN button for the current statement. Always plain EXPLAIN —
    | never ANALYZE, which would execute the statement.
    |
    */

    'explain' => true,

    /*
    |--------------------------------------------------------------------------
    | Branding
    |--------------------------------------------------------------------------
    |
    | `accent` is injected as an inline --dc-accent, so rebranding needs no
    | rebuild. `scheme` may be light, dark, or auto (follow the host app's
    | `.dark` ancestor class). Every other colour stays overridable in CSS:
    |
    |   .dc-root { --dc-bg: #0b0d10; }
    |
    | `url` makes the logo + name a link out of the console, so there is always a
    | way back to the app. Set null to leave it as plain text.
    |
    */

    'brand' => [
        'name' => env('DB_CONSOLE_BRAND', env('APP_NAME', 'DB Console')),
        'url' => env('DB_CONSOLE_BRAND_URL', '/'),
        'accent' => env('DB_CONSOLE_ACCENT', '#e11d2f'),
        'scheme' => env('DB_CONSOLE_SCHEME', 'auto'),
        'logo' => null,
    ],

    /*
    |--------------------------------------------------------------------------
    | Locale
    |--------------------------------------------------------------------------
    |
    | null follows the application locale. Set to "th" or "en" to pin the
    | console's own copy regardless of the app.
    |
    */

    'locale' => env('DB_CONSOLE_LOCALE'),

];
