<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Phattarachai\DbConsole\DbConsole;
use Symfony\Component\HttpFoundation\Response;

/**
 * Appended to the console's middleware stack by the service provider, so it
 * cannot be dropped by editing `db-console.middleware`.
 *
 * A rejected **guest** is redirected to the host app's login screen (remembering
 * the console URL as the intended destination). Everyone else — a signed-in user
 * the gate still refuses, an XHR, or an app with no login route configured —
 * gets a plain 403.
 */
final class Authorize
{
    public function handle(Request $request, Closure $next): Response
    {
        if (DbConsole::check($request)) {
            return $next($request);
        }

        if ($request->user() === null && ! $request->expectsJson()) {
            $login = $this->loginUrl();

            if ($login !== null) {
                return redirect()->guest($login);
            }
        }

        abort(403);
    }

    /** Resolve `redirect_guests_to` as a route name first, then as a plain URL. */
    private function loginUrl(): ?string
    {
        $target = config('db-console.redirect_guests_to');

        if (! is_string($target) || $target === '') {
            return null;
        }

        if (Route::has($target)) {
            return route($target);
        }

        return str_contains($target, '/') ? url($target) : null;
    }
}
