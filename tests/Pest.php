<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Tests\Fixtures\DcUser;
use Phattarachai\DbConsole\Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class)->in('Feature');
uses(TestCase::class)->in('Unit');

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
