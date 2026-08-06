<?php

declare(strict_types=1);

use Phattarachai\DbConsole\Support\FavoriteStore;
use Phattarachai\DbConsole\Tests\Fixtures\DcUser;

use function Pest\Laravel\actingAs;

it('stars and unstars a table', function (): void {
    $user = dcUser();

    actingAs($user)
        ->postJson(route('db-console.favorite'), ['table' => 'dc_items'])
        ->assertOk()
        ->assertJsonPath('favorites', ['public.dc_items']);

    actingAs($user)
        ->postJson(route('db-console.favorite'), ['table' => 'dc_items'])
        ->assertOk()
        ->assertJsonPath('favorites', []);
});

it('hands the current favourites to the page', function (): void {
    $user = dcUser();

    actingAs($user)->postJson(route('db-console.favorite'), ['table' => 'dc_owners'])->assertOk();

    actingAs($user)
        ->get(route('db-console.index'))
        ->assertOk()
        ->assertInertia(fn ($page) => $page->where('favorites', ['public.dc_owners']));
});

it('keeps favourites per connection', function (): void {
    $store = app(FavoriteStore::class);

    actingAs(dcUser());

    $store->toggle('default', 'public', 'dc_items');

    expect($store->all('default'))->toBe(['public.dc_items'])
        ->and($store->all('analytic'))->toBe([]);
});

it('never shows one user the favourites of another', function (): void {
    $store = app(FavoriteStore::class);

    actingAs(dcUser());
    $store->toggle('default', 'public', 'dc_items');

    $other = DcUser::query()->create([
        'name' => 'Other', 'email' => 'other@example.test', 'password' => bcrypt('secret'),
    ]);

    actingAs($other);

    expect($store->all('default'))->toBe([]);
});

it('requires a table name', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.favorite'), [])
        ->assertStatus(422);
});

it('is behind the gate', function (): void {
    $this->post(route('db-console.favorite'), ['table' => 'dc_items'])
        ->assertRedirect();
});
