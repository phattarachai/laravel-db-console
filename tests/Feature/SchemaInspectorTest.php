<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\SchemaInspector;
use Phattarachai\DbConsole\Support\SqlRunner;

it('introspects columns, indexes and foreign keys for a known table', function (): void {
    $items = new SchemaInspector(Connection::resolve())->details('public', 'dc_items');

    expect($items)->not->toBeNull()
        ->and($items['type'])->toBe('table')
        ->and(collect($items['columns'])->firstWhere('name', 'id')['pk'])->toBeTrue()
        ->and(collect($items['columns'])->firstWhere('name', 'owner_id')['fk'])->toBe('dc_owners.id')
        ->and(collect($items['indexes'])->pluck('type'))->toContain('PRIMARY')
        ->and($items['foreignKeys'])->not->toBeEmpty()
        ->and($items['foreignKeys'][0]['references'])->toBe('dc_owners.id')
        ->and($items['foreignKeys'][0]['onDelete'])->toBe('CASCADE');
});

it('hides configured tables from the tree and rejects them in SQL', function (): void {
    $connection = Connection::resolve();
    $names = collect(new SchemaInspector($connection)->tree()[0]['tables'])->pluck('name');

    expect($names)->not->toContain('dc_hidden')
        ->and($names)->not->toContain('db_console_history');

    expect(fn () => new SqlRunner($connection)->run('SELECT * FROM dc_hidden'))
        ->toThrow(SqlGuardException::class);
});

it('keeps the tree shallow — names, kind and row count only', function (): void {
    dcOwner();

    $entry = collect(new SchemaInspector(Connection::resolve())->tree()[0]['tables'])
        ->firstWhere('name', 'dc_owners');

    expect(array_keys($entry))->toBe(['name', 'type', 'rowCount'])
        ->and($entry['type'])->toBe('table')
        ->and($entry['rowCount'])->toBe(1);
});

it('counts a whole schema in a fixed number of queries, however many tables it has', function (): void {
    $inspector = new SchemaInspector(Connection::resolve());

    DB::connection()->flushQueryLog();
    DB::connection()->enableQueryLog();

    $inspector->tree();

    // getTables + getViews + the batched estimate + one batched count(*) — and it
    // stays there as tables are added, which is the whole point of the split.
    expect(DB::connection()->getQueryLog())->toHaveCount(4);
});

it('refuses a table outside the browsable schemas', function (): void {
    expect(fn () => new SchemaInspector(Connection::resolve())->details('pg_catalog', 'pg_class'))
        ->toThrow(SqlGuardException::class);
});

it('refuses a hidden table and one that does not exist', function (): void {
    $inspector = new SchemaInspector(Connection::resolve());

    expect(fn () => $inspector->details('public', 'dc_hidden'))->toThrow(SqlGuardException::class)
        ->and(fn () => $inspector->details('public', 'no_such_table'))->toThrow(SqlGuardException::class);
});

it('fails loudly when a configured connection is not Postgres', function (): void {
    config()->set('db-console.connections', ['sqlite' => []]);

    expect(fn () => Connection::resolve('sqlite')->db())
        ->toThrow(UnsupportedDriverException::class, 'driver [sqlite]');
});
