<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Support\QueryStore;

use function Pest\Laravel\actingAs;
use function Pest\Laravel\artisan;

it('saves, lists and forgets a query for its owner only', function (): void {
    actingAs(dcUser());
    $store = app(QueryStore::class);

    $saved = $store->save('default', 'SELECT 1', 'probe');

    expect(collect($store->saved())->pluck('id'))->toContain($saved['id'])
        ->and($store->save('default', 'SELECT 1', 'probe again')['id'])->toBe($saved['id']);

    expect($store->forget($saved['id']))->toBeTrue()
        ->and($store->forget($saved['id']))->toBeFalse();
});

it('prunes history older than the retention window', function (): void {
    DB::table('db_console_history')->insert([
        'user_id' => dcUser()->id,
        'connection' => 'default',
        'sql' => 'SELECT 1',
        'rows' => 1,
        'elapsed_ms' => 1,
        'status' => 'ok',
        'created_at' => now()->subDays(400),
    ]);

    artisan('db-console:prune')->assertSuccessful();

    expect(DB::table('db_console_history')->where('created_at', '<', now()->subDays(90))->count())->toBe(0);
});
