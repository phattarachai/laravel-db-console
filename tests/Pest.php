<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Tests\Fixtures\DcUser;
use Phattarachai\DbConsole\Tests\TestCase;

// Postgres runs each test in a rolled-back transaction. MySQL can't: the
// console's READ ONLY transaction cannot start inside another one, so its tests
// truncate the tables afterwards instead.
uses(TestCase::class, dcDriver() === 'pgsql' ? RefreshDatabase::class : DatabaseTruncation::class)->in('Feature');
uses(TestCase::class)->in('Unit');

/**
 * The driver the suite runs on: `pgsql` (default), `mysql` or `mariadb`.
 */
function dcDriver(): string
{
    $driver = (string) (getenv('DB_CONNECTION') ?: 'pgsql');

    return in_array($driver, ['pgsql', 'mysql', 'mariadb'], strict: true) ? $driver : 'pgsql';
}

function dcIsMySql(): bool
{
    return dcDriver() !== 'pgsql';
}

/**
 * The schema the fixture tables live in: `public`, or the MySQL database.
 */
function dcSchema(): string
{
    return dcIsMySql() ? (string) config('database.connections.'.dcDriver().'.database') : 'public';
}

/**
 * A SELECT the keyword guard passes but that writes a row — the engine's READ
 * ONLY transaction is what has to stop it. Postgres advances a sequence; MySQL
 * calls a stored function that inserts (see the fixture migration).
 */
function dcWriteProbeSql(): string
{
    return dcIsMySql() ? 'SELECT dc_write_probe()' : "SELECT nextval('dc_owners_id_seq')";
}

/**
 * A signed-in user the gate accepts.
 */
function dcUser(): DcUser
{
    return DcUser::query()->firstOrCreate(
        ['email' => 'console@example.test'],
        ['name' => 'Console User', 'password' => bcrypt('secret')],
    );
}

/**
 * One parent row plus a child, so every test has something to read and edit.
 *
 * @return object{id: int}
 */
function dcOwner(string $name = 'Owner One'): object
{
    $id = DB::table('dc_owners')->insertGetId([
        'name' => $name,
        'secret_token' => 'shhh',
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return DB::table('dc_owners')->where('id', $id)->firstOrFail();
}

/**
 * Flip the default connection to `write` and hand back the resolved value object.
 */
function dcWritable(): Connection
{
    config()->set('db-console.connections.default.mode', 'write');

    return Connection::resolve();
}

/**
 * A real table in a schema the connection was never configured to browse.
 *
 * @return array{0: string, 1: string} [schema, table]
 */
function dcForeignTable(): array
{
    return dcIsMySql() ? ['mysql', 'user'] : ['pg_catalog', 'pg_class'];
}
