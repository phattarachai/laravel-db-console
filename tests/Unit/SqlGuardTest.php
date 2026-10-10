<?php

declare(strict_types=1);

use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\SqlGuard;

/**
 * A guard for one dialect, without touching a database — classifying never
 * connects, it only reads the driver from config.
 */
function dcGuard(string $driver, string $mode = 'read'): SqlGuard
{
    config()->set("database.connections.dc_{$driver}", ['driver' => $driver, 'database' => 'dc']);
    config()->set('db-console.connections', ["dc_{$driver}" => ['mode' => $mode]]);

    return new SqlGuard(Connection::resolve("dc_{$driver}"));
}

it('allows the read statements each dialect has', function (string $driver, string $sql): void {
    expect(dcGuard($driver)->classify($sql))->toBe('read');
})->with([
    ['pgsql', 'SELECT * FROM dc_owners'],
    ['pgsql', "SELECT \$\$it's a string\$\$, E'a\\'b'"],
    ['pgsql', '/* outer /* nested */ still a comment */ SELECT 1'],
    ['mysql', 'SELECT `name` FROM `dc_owners` WHERE name = "x" -- note'],
    ['mysql', "SELECT 'it\\'s' # trailing comment"],
    ['mysql', 'DESCRIBE dc_owners'],
    ['mysql', 'SHOW CREATE TABLE dc_owners'],
    ['mysql', 'SELECT 1--1'],
    ['mariadb', 'TABLE dc_owners'],
]);

it('blocks MySQL statements that change state or run code', function (string $sql, string $keyword): void {
    expect(fn () => dcGuard('mysql', 'write')->classify($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.blocked', ['keyword' => $keyword]));
})->with([
    ['SET SESSION sql_mode = ""', 'SET'],
    ['LOCK TABLES dc_owners WRITE', 'LOCK'],
    ['UNLOCK TABLES', 'UNLOCK'],
    ['HANDLER dc_owners OPEN', 'HANDLER'],
    ["LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE dc_owners", 'LOAD'],
    ['CALL some_procedure()', 'CALL'],
    ['DO SLEEP(10)', 'DO'],
    ['FLUSH PRIVILEGES', 'FLUSH'],
    ['KILL 42', 'KILL'],
    ["INSTALL PLUGIN x SONAME 'x.so'", 'INSTALL'],
    ["PREPARE s FROM 'DROP TABLE dc_owners'", 'PREPARE'],
    ['EXECUTE s', 'EXECUTE'],
    ['USE other_database', 'USE'],
    ['START TRANSACTION', 'START'],
    ['RENAME TABLE dc_owners TO x', 'RENAME'],
]);

it('treats REPLACE as a write', function (): void {
    expect(dcGuard('mysql', 'write')->classify("REPLACE INTO dc_owners (id, name) VALUES (1, 'x')"))->toBe('write')
        ->and(fn () => dcGuard('mysql')->classify("REPLACE INTO dc_owners (id, name) VALUES (1, 'x')"))
        ->toThrow(SqlGuardException::class, __('db-console::guard.read_only', ['keyword' => 'REPLACE']));
});

it('refuses a read that writes somewhere else', function (string $driver, string $sql): void {
    expect(fn () => dcGuard($driver, 'write')->classify($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.select_into', ['keyword' => 'SELECT']));
})->with([
    ['mysql', "SELECT * FROM dc_owners INTO OUTFILE '/tmp/owners.csv'"],
    ['mysql', "SELECT * FROM dc_owners INTO DUMPFILE '/tmp/owners'"],
    ['mysql', 'SELECT name INTO @who FROM dc_owners LIMIT 1'],
    ['mysql', "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */"],
    ['pgsql', 'SELECT * INTO dc_copy FROM dc_owners'],
]);

it('refuses functions that act outside the transaction', function (string $driver, string $sql, string $function): void {
    expect(fn () => dcGuard($driver)->classify($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.blocked_function', ['function' => $function]));
})->with([
    ['mysql', "SELECT LOAD_FILE('/etc/passwd')", 'load_file'],
    ['mysql', "SELECT 1--1, LOAD_FILE('/etc/passwd')", 'load_file'],
    ['pgsql', "SELECT pg_read_file('/etc/passwd')", 'pg_read_file'],
    ['pgsql', 'SELECT "pg_read_file"(\'/etc/passwd\')', 'pg_read_file'],
    ['pgsql', "SELECT * FROM dblink('host=x', 'DELETE FROM t') AS t(x int)", 'dblink'],
    ['pgsql', "SELECT set_config('statement_timeout', '0', true)", 'set_config'],
    ['pgsql', 'SELECT pg_terminate_backend(42)', 'pg_terminate_backend'],
]);

it('reads every hiding place for a second statement the way the engine does', function (string $driver, string $sql): void {
    expect(fn () => dcGuard($driver, 'write')->classify($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.single_statement'));
})->with([
    'pg dollar quote' => ['pgsql', "UPDATE t SET a = \$\$'\$\$; DROP TABLE t; SELECT \$\$'\$\$"],
    'pg tagged dollar quote' => ['pgsql', "UPDATE t SET a = \$x\$'\$x\$; DROP TABLE t; SELECT \$x\$'\$x\$"],
    'pg E-string' => ['pgsql', "UPDATE t SET a = E'\\''; DROP TABLE t; SELECT E'\\''"],
    'pg plain string under backslash escapes' => ['pgsql', "UPDATE t SET a = '\\'; DROP TABLE t; SELECT '"],
    'mysql backslash escape' => ['mysql', "UPDATE t SET a = '\\''; DROP TABLE t; SELECT '\\''"],
    'mysql double-quoted string' => ['mysql', 'UPDATE t SET a = "\\""; DROP TABLE t; SELECT "\\""'],
    'mysql NO_BACKSLASH_ESCAPES' => ['mysql', "UPDATE t SET a = '\\'; DROP TABLE t; SELECT '"],
    'mysql executable comment' => ['mysql', 'UPDATE t SET a = 1 /*! ; DROP TABLE t */'],
    'mariadb executable comment' => ['mariadb', 'UPDATE t SET a = 1 /*M! ; DROP TABLE t */'],
    'mysql hash comment' => ['mysql', "UPDATE t SET a = 1 # '\n; DROP TABLE t; SELECT '"],
    'mysql double dash without a space' => ['mysql', 'UPDATE t SET a = 1--1; DROP TABLE t'],
]);

it('finds a hidden table behind any quoting', function (string $driver, string $sql): void {
    config()->set('db-console.hidden_tables', ['dc_hidden']);

    expect(fn () => dcGuard($driver)->classify($sql))
        ->toThrow(SqlGuardException::class, __('db-console::guard.hidden_table', ['table' => 'dc_hidden']));
})->with([
    ['pgsql', 'SELECT * FROM "dc_hidden"'],
    ['mysql', 'SELECT * FROM `dc_hidden`'],
    'mysql ANSI_QUOTES identifier' => ['mysql', 'SELECT * FROM "dc_hidden"'],
    ['mysql', 'SELECT 1 /*! FROM dc_hidden */'],
]);
