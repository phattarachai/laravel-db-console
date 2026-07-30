<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\SqlRunner;

it('runs a read-only SELECT and returns the result shape', function (): void {
    dcUser();

    $result = new SqlRunner(Connection::resolve())->run('SELECT id, email FROM dc_users ORDER BY id LIMIT 2');

    expect($result)->toHaveKeys(['kind', 'columns', 'rows', 'elapsedMs', 'truncated'])
        ->and($result['kind'])->toBe('read')
        ->and($result['truncated'])->toBeFalse()
        ->and(collect($result['columns'])->pluck('name')->all())->toBe(['id', 'email'])
        ->and(collect($result['columns'])->firstWhere('name', 'id')['type'])->toBe('bigint')
        ->and($result['rows'])->not->toBeEmpty()
        ->and($result['rows'][0])->toHaveKeys(['id', 'email']);
});

it('masks configured columns server-side', function (): void {
    dcOwner();

    $result = new SqlRunner(Connection::resolve())->run('SELECT id, secret_token FROM dc_owners ORDER BY id LIMIT 1');

    expect($result['rows'][0]['secret_token'])->toBe('***');
});

it('rejects DML on a read-only connection', function (): void {
    expect(fn() => new SqlRunner(Connection::resolve())->run('DELETE FROM dc_owners'))
        ->toThrow(SqlGuardException::class, __('db-console::guard.read_only', ['keyword' => 'DELETE']));
});

it('never allows DDL, even on a writable connection', function (string $sql, string $keyword): void {
    expect(fn() => new SqlRunner(dcWritable())->run($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.blocked', ['keyword' => $keyword]));
})->with([
    ['DROP TABLE dc_owners', 'DROP'],
    ['ALTER TABLE dc_owners ADD COLUMN x int', 'ALTER'],
    ['TRUNCATE dc_owners', 'TRUNCATE'],
    ['CREATE TABLE zzz (id int)', 'CREATE'],
]);

it('rejects multiple statements', function (): void {
    expect(fn() => new SqlRunner(Connection::resolve())->run('SELECT 1; DROP TABLE dc_owners;'))
        ->toThrow(SqlGuardException::class, __('db-console::guard.single_statement'));
});

it('blocks a write that passes the keyword guard, via the read-only transaction', function (): void {
    dcOwner();
    $before = DB::table('dc_owners')->max('id');

    expect(fn() => new SqlRunner(Connection::resolve())->run("SELECT nextval('dc_owners_id_seq')"))
        ->toThrow(SqlGuardException::class);

    expect(DB::table('dc_owners')->max('id'))->toBe($before);
});

it('commits a write on a writable connection', function (): void {
    $owner = dcOwner();

    $result = new SqlRunner(dcWritable())->run("UPDATE dc_owners SET name = 'dc-write-probe' WHERE id = {$owner->id}");

    expect($result['kind'])->toBe('write')
        ->and($result['rowsAffected'])->toBe(1)
        ->and(DB::table('dc_owners')->where('id', $owner->id)->value('name'))->toBe('dc-write-probe');
});

it('explains a statement without executing it', function (): void {
    dcOwner();
    $before = DB::table('dc_owners')->count();

    $result = new SqlRunner(Connection::resolve())->explain('SELECT * FROM dc_owners');

    expect($result['kind'])->toBe('explain')
        ->and($result['plan'])->not->toBeEmpty()
        ->and(DB::table('dc_owners')->count())->toBe($before);
});
