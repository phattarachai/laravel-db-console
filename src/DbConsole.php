<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Registration surface for the host application. Mirrors Horizon/Pulse: the app
 * declares who may open the console, and the Authorize middleware enforces it.
 *
 *   DbConsole::auth(fn ($request) => $request->user()?->isAdmin());
 */
final class DbConsole
{
    public const string VERSION = '0.1.0';

    /** @var (Closure(Request): bool)|null */
    private static ?Closure $authUsing = null;

    /**
     * @param  Closure(Request): bool  $callback
     */
    public static function auth(Closure $callback): void
    {
        self::$authUsing = $callback;
    }

    /**
     * Local is always open — the console's whole point is being there when you
     * are debugging your own machine. Otherwise the registered callback decides,
     * falling back to the `viewDbConsole` gate when the app defined one instead.
     */
    public static function check(Request $request): bool
    {
        if (app()->environment('local')) {
            return true;
        }

        if (self::$authUsing instanceof Closure) {
            return call_user_func(self::$authUsing, $request);
        }

        return Gate::has('viewDbConsole') && Gate::allows('viewDbConsole');
    }

    /** Reset the registered callback. Test seam. */
    public static function flushAuth(): void
    {
        self::$authUsing = null;
    }
}
