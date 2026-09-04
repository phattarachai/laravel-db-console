<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

use function Pest\Laravel\actingAs;

/**
 * Seed `count` owners named "Owner 01", "Owner 02", … so ordering and paging
 * are predictable.
 */
function dcOwners(int $count): void
{
    $rows = [];

    for ($i = 1; $i <= $count; $i++) {
        $rows[] = [
            'name' => sprintf('Owner %02d', $i),
            'secret_token' => 'shhh',
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    DB::table('dc_owners')->insert($rows);
}

function dcRows(array $body): TestResponse
{
    return actingAs(dcUser())->postJson(route('db-console.rows'), [
        'table' => 'dc_owners',
        'schema' => 'public',
        ...$body,
    ]);
}

it('returns a paginated slice with the expected shape', function (): void {
    dcOwners(3);

    dcRows(['perPage' => 50])
        ->assertOk()
        ->assertJsonStructure(['rows', 'page', 'perPage', 'hasMore', 'elapsedMs'])
        ->assertJsonPath('hasMore', false)
        ->assertJsonCount(3, 'rows');
});

it('flags a further page with hasMore and never overfills', function (): void {
    dcOwners(5);

    $response = dcRows(['perPage' => 2])->assertOk();

    expect($response->json('hasMore'))->toBeTrue()
        ->and($response->json('rows'))->toHaveCount(2);
});

it('pages without repeating rows', function (): void {
    dcOwners(5);

    $first = dcRows(['perPage' => 2, 'page' => 1])->json('rows.0.name');
    $third = dcRows(['perPage' => 2, 'page' => 2])->json('rows.0.name');

    expect($first)->toBe('Owner 01')->and($third)->toBe('Owner 03');
});

it('filters with an equality condition', function (): void {
    dcOwners(3);

    $response = dcRows(['filters' => [['column' => 'name', 'operator' => 'eq', 'value' => 'Owner 02']]])->assertOk();

    expect($response->json('rows'))->toHaveCount(1)
        ->and($response->json('rows.0.name'))->toBe('Owner 02');
});

it('filters case-insensitively with contains', function (): void {
    dcOwners(2);

    $response = dcRows(['filters' => [['column' => 'name', 'operator' => 'contains', 'value' => 'owner']]])->assertOk();

    expect($response->json('rows'))->toHaveCount(2);
});

it('filters a range with between', function (): void {
    dcOwners(5);

    $response = dcRows([
        'sort' => ['column' => 'name', 'dir' => 'asc'],
        'filters' => [['column' => 'name', 'operator' => 'between', 'value' => ['Owner 02', 'Owner 04']]],
    ])->assertOk();

    expect(array_column($response->json('rows'), 'name'))->toBe(['Owner 02', 'Owner 03', 'Owner 04']);
});

it('filters a set with in', function (): void {
    dcOwners(5);

    $response = dcRows(['filters' => [['column' => 'name', 'operator' => 'in', 'value' => ['Owner 01', 'Owner 05']]]])->assertOk();

    expect($response->json('rows'))->toHaveCount(2);
});

it('filters nulls', function (): void {
    dcOwners(2);
    DB::table('dc_owners')->where('name', 'Owner 01')->update(['secret_token' => null]);

    $response = dcRows(['filters' => [['column' => 'created_at', 'operator' => 'not_null']]])->assertOk();

    expect($response->json('rows'))->toHaveCount(2);
});

it('sorts descending', function (): void {
    dcOwners(3);

    $response = dcRows(['sort' => ['column' => 'name', 'dir' => 'desc']])->assertOk();

    expect($response->json('rows.0.name'))->toBe('Owner 03');
});

it('runs a quick search across text columns', function (): void {
    dcOwners(3);

    $response = dcRows(['search' => 'Owner 02'])->assertOk();

    expect($response->json('rows'))->toHaveCount(1)
        ->and($response->json('rows.0.name'))->toBe('Owner 02');
});

it('masks masked columns in the result', function (): void {
    dcOwners(1);

    expect(dcRows([])->json('rows.0.secret_token'))->toBe('***');
});

it('refuses to filter on a masked column', function (): void {
    dcOwners(1);

    dcRows(['filters' => [['column' => 'secret_token', 'operator' => 'eq', 'value' => 'shhh']]])
        ->assertStatus(422);
});

it('refuses an unknown column', function (): void {
    dcRows(['filters' => [['column' => 'nope', 'operator' => 'eq', 'value' => 'x']]])
        ->assertStatus(422);
});

it('refuses an unknown operator', function (): void {
    dcOwners(1);

    dcRows(['filters' => [['column' => 'name', 'operator' => 'drop', 'value' => 'x']]])
        ->assertStatus(422);
});

it('refuses a hidden table', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.rows'), ['table' => 'dc_hidden', 'schema' => 'public'])
        ->assertStatus(422);
});

it('refuses a schema the connection cannot browse', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.rows'), ['table' => 'pg_class', 'schema' => 'pg_catalog'])
        ->assertStatus(422);
});

it('requires a table name', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.rows'))
        ->assertStatus(422);
});

it('is behind the gate like every other endpoint', function (): void {
    $this->postJson(route('db-console.rows'), ['table' => 'dc_owners'])
        ->assertStatus(403);
});
