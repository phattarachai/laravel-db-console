<?php

declare(strict_types=1);

use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\SchemaInspector;
use Phattarachai\DbConsole\Support\SqlRunner;

it('introspects columns, indexes and foreign keys for a known table', function (): void {
    $items = collect(new SchemaInspector(Connection::resolve())->schemas()[0]['tables'])
        ->firstWhere('name', 'dc_items');

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
    $names = collect(new SchemaInspector($connection)->schemas()[0]['tables'])->pluck('name');

    expect($names)->not->toContain('dc_hidden')
        ->and($names)->not->toContain('db_console_history');

    expect(fn() => new SqlRunner($connection)->run('SELECT * FROM dc_hidden'))
        ->toThrow(SqlGuardException::class);
});

it('fails loudly when a configured connection is not Postgres', function (): void {
    config()->set('db-console.connections', ['sqlite' => []]);

    expect(fn() => Connection::resolve('sqlite')->db())
        ->toThrow(UnsupportedDriverException::class, 'driver [sqlite]');
});
