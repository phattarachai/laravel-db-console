<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Str;

/**
 * The two-request handshake behind a write: the first request gets a token, the
 * second sends it back with the statement it was issued for.
 *
 * The token is bound to the session, the connection and the exact SQL, and is
 * single use with a one-minute life — so a stale tab, a shared link, or an edited
 * statement can never replay someone else's confirmation.
 */
final class ConfirmToken
{
    private const int TTL_SECONDS = 60;

    public function issue(string $connectionKey, string $sql): string
    {
        $token = Str::random(32);

        Cache::put($this->cacheKey($token), $this->fingerprint($token, $connectionKey, $sql), self::TTL_SECONDS);

        return $token;
    }

    public function consume(?string $token, string $connectionKey, string $sql): bool
    {
        if ($token === null || $token === '') {
            return false;
        }

        $stored = Cache::get($this->cacheKey($token));

        if (!is_string($stored) || !hash_equals($stored, $this->fingerprint($token, $connectionKey, $sql))) {
            return false;
        }

        Cache::forget($this->cacheKey($token));

        return true;
    }

    private function cacheKey(string $token): string
    {
        return 'db-console:confirm:' . $token;
    }

    private function fingerprint(string $token, string $connectionKey, string $sql): string
    {
        return hash('sha256', implode('|', [$token, $this->owner(), $connectionKey, $sql]));
    }

    /**
     * The authenticated user outlives session rotation; a guest install has only
     * its session to bind to.
     */
    private function owner(): string
    {
        $id = auth()->id();

        return $id === null ? 'session:' . Session::getId() : 'user:' . $id;
    }
}
