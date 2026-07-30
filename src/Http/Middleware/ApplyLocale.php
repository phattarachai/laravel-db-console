<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Pins the console's own locale when `db-console.locale` is set, so the guard
 * messages raised deep in the SQL layer match the UI copy without threading a
 * locale through every call.
 */
final class ApplyLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = config('db-console.locale');

        if (is_string($locale) && $locale !== '') {
            app()->setLocale($locale);
        }

        return $next($request);
    }
}
