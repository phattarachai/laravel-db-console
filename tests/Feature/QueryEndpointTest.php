<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Support\ConfirmToken;

use function Pest\Laravel\actingAs;

it('executes read-only SQL over the endpoint', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.query'), ['sql' => 'SELECT 1 AS one'])
        ->assertOk()
        ->assertJsonPath('columns.0.name', 'one')
        ->assertJsonPath('rows.0.one', 1)
        ->assertJsonPath('truncated', expect: false);
});

it('returns 422 with a message when the endpoint gets a write on a read connection', function (): void {
    actingAs(dcUser())
        ->postJson(route('db-console.query'), ['sql' => 'UPDATE dc_owners SET name = null'])
        ->assertStatus(422)
        ->assertJsonPath('message', __('db-console::guard.read_only', ['keyword' => 'UPDATE']));
});

it('records every run in history, including rejections', function (): void {
    $user = dcUser();

    actingAs($user)->postJson(route('db-console.query'), ['sql' => 'SELECT 1 AS one'])->assertOk();
    actingAs($user)->postJson(route('db-console.query'), ['sql' => 'DELETE FROM dc_owners'])->assertStatus(422);

    $statuses = collect(DB::table('db_console_history')->orderByDesc('id')->limit(2)->pluck('status'));

    expect($statuses)->toContain('ok')->toContain('rejected');
});

it('demands a typed confirmation before running a write over the endpoint', function (): void {
    config()->set('db-console.connections.default.mode', 'write');
    config()->set('db-console.connections.default.confirm_writes', value: true);
    $owner = dcOwner();
    $sql = "UPDATE dc_owners SET name = 'dc-confirm-probe' WHERE id = {$owner->id}";

    $response = actingAs(dcUser())
        ->postJson(route('db-console.query'), ['sql' => $sql])
        ->assertStatus(409)
        ->assertJsonPath('confirm.statement', $sql);

    expect(DB::table('dc_owners')->where('id', $owner->id)->value('name'))->not->toBe('dc-confirm-probe');

    actingAs(dcUser())
        ->postJson(route('db-console.query'), ['sql' => $sql, 'confirm_token' => $response->json('confirm.token')])
        ->assertOk()
        ->assertJsonPath('rowsAffected', 1);

    expect(DB::table('dc_owners')->where('id', $owner->id)->value('name'))->toBe('dc-confirm-probe');
});

it('refuses a confirmation token bound to different SQL', function (): void {
    config()->set('db-console.connections.default.mode', 'write');
    $token = app(ConfirmToken::class)->issue('default', 'UPDATE dc_owners SET name = %27a%27');

    expect(app(ConfirmToken::class)->consume($token, 'default', 'DELETE FROM dc_owners'))->toBeFalse();
});

it('consumes a confirmation token only once', function (): void {
    $confirm = app(ConfirmToken::class);
    $token = $confirm->issue('default', 'SELECT 1');

    expect($confirm->consume($token, 'default', 'SELECT 1'))->toBeTrue()
        ->and($confirm->consume($token, 'default', 'SELECT 1'))->toBeFalse();
});

it('runs a write without confirmation when confirm_writes is off', function (): void {
    config()->set('db-console.connections.default.mode', 'write');
    config()->set('db-console.connections.default.confirm_writes', value: false);
    $owner = dcOwner();

    actingAs(dcUser())
        ->postJson(route('db-console.query'), [
            'sql' => "UPDATE dc_owners SET name = 'dc-noconfirm-probe' WHERE id = {$owner->id}",
        ])
        ->assertOk()
        ->assertJsonPath('rowsAffected', 1);

    expect(DB::table('dc_owners')->where('id', $owner->id)->value('name'))->toBe('dc-noconfirm-probe');
});
