<?php

declare(strict_types=1);

use Phattarachai\DbConsole\DbConsole;
use Phattarachai\DbConsole\Support\QueryStore;

use function Pest\Laravel\actingAs;
use function Pest\Laravel\get;

it('redirects guests to the login screen and remembers where they were going', function (): void {
    get(route('db-console.index'))
        ->assertRedirect(route('login'));

    expect(session('url.intended'))->toBe(route('db-console.index'));
});

it('forbids guests instead when no login route is configured', function (): void {
    config()->set('db-console.redirect_guests_to');

    get(route('db-console.index'))->assertForbidden();
});

it('forbids a guest XHR rather than redirecting it', function (): void {
    get(route('db-console.index'), ['Accept' => 'application/json'])->assertForbidden();
});

it('forbids a signed-in user the gate rejects, without looping back to login', function (): void {
    DbConsole::auth(fn (): bool => false);

    actingAs(dcUser())
        ->get(route('db-console.index'))
        ->assertForbidden();
});

it('keeps share links behind the gate', function (): void {
    $token = app(QueryStore::class)->share('default', 'SELECT 1');

    get(route('db-console.shared', $token))->assertRedirect(route('login'));
});
