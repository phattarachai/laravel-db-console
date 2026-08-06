<?php

declare(strict_types=1);

use function Pest\Laravel\actingAs;

it('serves one table in full', function (): void {
    dcOwner();

    actingAs(dcUser())
        ->getJson(route('db-console.table', ['table' => 'dc_items', 'schema' => 'public']))
        ->assertOk()
        ->assertJsonPath('name', 'dc_items')
        ->assertJsonPath('type', 'table')
        ->assertJsonStructure(['name', 'type', 'rowCount', 'columns', 'indexes', 'foreignKeys', 'rows']);
});

it('defaults to the connection first schema', function (): void {
    actingAs(dcUser())
        ->getJson(route('db-console.table', ['table' => 'dc_owners']))
        ->assertOk()
        ->assertJsonPath('name', 'dc_owners');
});

it('masks the same columns the page payload used to', function (): void {
    dcOwner();

    $response = actingAs(dcUser())
        ->getJson(route('db-console.table', ['table' => 'dc_owners']))
        ->assertOk();

    expect($response->json('rows.0.secret_token'))->toBe('***');
});

it('refuses a hidden table', function (): void {
    actingAs(dcUser())
        ->getJson(route('db-console.table', ['table' => 'dc_hidden']))
        ->assertStatus(422);
});

it('refuses a schema the connection cannot browse', function (): void {
    actingAs(dcUser())
        ->getJson(route('db-console.table', ['table' => 'pg_class', 'schema' => 'pg_catalog']))
        ->assertStatus(422);
});

it('requires a table name', function (): void {
    actingAs(dcUser())
        ->getJson(route('db-console.table'))
        ->assertStatus(422);
});

it('is behind the gate like every other endpoint', function (): void {
    $this->get(route('db-console.table', ['table' => 'dc_owners']))
        ->assertRedirect();
});
