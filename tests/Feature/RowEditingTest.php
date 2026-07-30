<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\RowWriter;
use Phattarachai\DbConsole\Support\SchemaInspector;

use function Pest\Laravel\actingAs;

it('refuses to edit a row on a read-only connection', function (): void {
    $connection = Connection::resolve();
    $writer = new RowWriter($connection, new SchemaInspector($connection));

    expect(fn() => $writer->apply('public', 'dc_owners', 'update', ['id' => 1], ['name' => 'nope']))
        ->toThrow(SqlGuardException::class);
});

it('refuses to write a masked column', function (): void {
    $owner = dcOwner();
    $connection = dcWritable();
    $writer = new RowWriter($connection, new SchemaInspector($connection));

    expect(fn() => $writer->apply('public', 'dc_owners', 'update', ['id' => $owner->id], ['secret_token' => 'x']))
        ->toThrow(SqlGuardException::class);
});

it('updates exactly one row through the row writer', function (): void {
    $owner = dcOwner();
    $connection = dcWritable();
    $writer = new RowWriter($connection, new SchemaInspector($connection));

    $result = $writer->apply('public', 'dc_owners', 'update', ['id' => $owner->id], ['name' => 'dc-row-probe']);

    expect($result['affected'])->toBe(1)
        ->and($result['row']['name'])->toBe('dc-row-probe')
        ->and($result['sql'])->toContain('update');
});

it('still confirms a row delete even when confirm_writes is off', function (): void {
    config()->set('db-console.connections.default.mode', 'write');
    config()->set('db-console.connections.default.confirm_writes', value: false);
    $itemId = DB::table('dc_items')->insertGetId([
        'name' => 'dc-delete-probe',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $response = actingAs(dcUser())
        ->postJson(route('db-console.row'), [
            'schema' => 'public',
            'table' => 'dc_items',
            'action' => 'delete',
            'pk' => ['id' => $itemId],
        ])
        ->assertStatus(409)
        ->assertJsonPath('confirm.statement', fn(string $sql): bool => str_contains($sql, 'delete'));

    expect(DB::table('dc_items')->where('id', $itemId)->exists())->toBeTrue();

    actingAs(dcUser())
        ->postJson(route('db-console.row'), [
            'schema' => 'public',
            'table' => 'dc_items',
            'action' => 'delete',
            'pk' => ['id' => $itemId],
            'confirm_token' => $response->json('confirm.token'),
        ])
        ->assertOk()
        ->assertJsonPath('affected', 1);

    expect(DB::table('dc_items')->where('id', $itemId)->exists())->toBeFalse();
});

it('inserts a row without confirmation when confirm_writes is off', function (): void {
    config()->set('db-console.connections.default.mode', 'write');
    config()->set('db-console.connections.default.confirm_writes', value: false);

    actingAs(dcUser())
        ->postJson(route('db-console.row'), [
            'schema' => 'public',
            'table' => 'dc_items',
            'action' => 'create',
            'values' => ['name' => 'dc-insert-probe'],
        ])
        ->assertOk()
        ->assertJsonPath('affected', 1);

    expect(DB::table('dc_items')->where('name', 'dc-insert-probe')->exists())->toBeTrue();
});
