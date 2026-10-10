<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\SqlRunner;

/*
 * The engine layer: what the database itself refuses once a statement is past
 * the keyword guard. Each test here is a write the guard is not expected to
 * catch on its own.
 */

it('refuses a write hidden inside a SELECT, and leaves nothing behind', function (): void {
    dcOwner();
    $before = DB::table('dc_owners')->count();
    $maxId = DB::table('dc_owners')->max('id');

    expect(fn () => new SqlRunner(Connection::resolve())->run(dcWriteProbeSql()))
        ->toThrow(SqlGuardException::class, dcIsMySql() ? 'READ ONLY transaction' : 'read-only transaction');

    expect(DB::table('dc_owners')->count())->toBe($before)
        ->and(DB::table('dc_owners')->max('id'))->toBe($maxId);
});

it('never smuggles a second statement past the guard inside a literal', function (string $sql): void {
    $owner = dcOwner();

    expect(fn () => new SqlRunner(dcWritable())->run(str_replace(':id', (string) $owner->id, $sql)))
        ->toThrow(SqlGuardException::class);

    expect(Schema::hasTable('dc_items'))->toBeTrue();
})->with(fn (): array => dcIsMySql()
    ? [
        'backslash-escaped quote' => ["UPDATE dc_owners SET name = '\\'' WHERE id = :id; DROP TABLE dc_items; SELECT '\\''"],
        'executable comment' => ['UPDATE dc_owners SET name = 1 WHERE id = :id /*! ; DROP TABLE dc_items */'],
        'hash comment' => ["UPDATE dc_owners SET name = 1 WHERE id = :id # '\n; DROP TABLE dc_items; SELECT '"],
        'double dash without a space' => ['UPDATE dc_owners SET name = 1--1 ; DROP TABLE dc_items'],
    ]
    : [
        'dollar-quoted string' => ["UPDATE dc_owners SET name = \$\$'\$\$ WHERE id = :id; DROP TABLE dc_items; SELECT \$\$'\$\$"],
        'tagged dollar quote' => ["UPDATE dc_owners SET name = \$q\$'\$q\$ WHERE id = :id; DROP TABLE dc_items; SELECT \$q\$'\$q\$"],
        'E-string escape' => ["UPDATE dc_owners SET name = E'\\'' WHERE id = :id; DROP TABLE dc_items; SELECT E'\\''"],
    ]);

it('refuses a locking read on a read-only connection', function (): void {
    expect(fn () => new SqlRunner(Connection::resolve())->run('SELECT * FROM dc_owners FOR UPDATE'))
        ->toThrow(SqlGuardException::class);
});

it('prepares exactly one statement, whatever the guard let through', function (): void {
    $connection = Connection::resolve();
    $db = $connection->db();
    $dialect = $connection->dialect();

    expect(fn () => $dialect->read($db, 1000, fn () => $dialect->prepare($db, 'SELECT 1; SELECT 2')->execute()))
        ->toThrow(PDOException::class);
});

it('stops a read at the connection timeout', function (): void {
    config()->set('db-console.connections.default.timeout', 300);
    $slow = dcIsMySql()
        ? 'SELECT COUNT(*) FROM information_schema.columns a, information_schema.columns b, information_schema.columns c'
        : 'SELECT pg_sleep(3)';

    $startedAt = microtime(true);

    expect(fn () => new SqlRunner(Connection::resolve())->run($slow))->toThrow(SqlGuardException::class)
        ->and(microtime(true) - $startedAt)->toBeLessThan(2.5);
});

it('puts the host session back the way it found it', function (): void {
    $variable = dcDriver() === 'mariadb' ? 'max_statement_time' : 'max_execution_time';
    $before = DB::selectOne("SELECT @@SESSION.{$variable} AS value")->value;

    new SqlRunner(Connection::resolve())->run('SELECT 1');

    expect(DB::selectOne("SELECT @@SESSION.{$variable} AS value")->value)->toEqual($before)
        ->and(DB::selectOne('SELECT @@SESSION.transaction_read_only AS value')->value)->toEqual(0);
})->skip(fn (): bool => ! dcIsMySql(), 'Postgres scopes both to the transaction with SET LOCAL');
