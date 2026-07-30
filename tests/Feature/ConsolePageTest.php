<?php

declare(strict_types=1);

use Phattarachai\DbConsole\Support\QueryStore;

use function Pest\Laravel\actingAs;

it('serves live Postgres introspection to an authorised user', function (): void {
    dcOwner();

    actingAs(dcUser())
        ->get(route('db-console.index'))
        ->assertOk()
        ->assertInertia(fn($page) => $page
            ->component('DbConsole')
            ->has('connection', fn($connection) => $connection
                ->where('name', 'pgsql')
                ->where('mode', 'read')
                ->has('database')
                ->has('key')
                ->has('label')
                ->has('confirmWrites')
                ->where('driver', fn(string $driver): bool => str_contains($driver, 'PostgreSQL')))
            ->has('connections')
            ->has('endpoints.query')
            ->has('endpoints.explain')
            ->has('endpoints.row')
            ->has('brand.accent')
            ->has('strings')
            ->has('features')
            ->has('sql.saved')
            ->has('sql.history')
            ->where('schemas.0.name', 'public')
            ->where('schemas.0.tables', fn($tables): bool => collect($tables)->pluck('name')->contains('dc_owners'))
            ->has('schemas.0.tables.0', fn($table) => $table
                ->has('name')->has('type')->has('rowCount')
                ->has('columns')->has('indexes')->has('foreignKeys')->has('rows')
                ->etc()));
});

it('reopens a shared query for a user who may already see the console', function (): void {
    actingAs(dcUser());
    $token = app(QueryStore::class)->share('default', 'SELECT 42 AS answer');

    expect(app(QueryStore::class)->resolveShare($token))
        ->toMatchArray(['connection' => 'default', 'sql' => 'SELECT 42 AS answer']);

    actingAs(dcUser())
        ->get(route('db-console.shared', $token))
        ->assertOk()
        ->assertInertia(fn($page) => $page->component('DbConsole')->where('shared.sql', 'SELECT 42 AS answer')->etc());

    expect(app(QueryStore::class)->resolveShare('nope-not-a-token'))->toBeNull();
});
