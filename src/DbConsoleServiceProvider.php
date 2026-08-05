<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Override;
use Phattarachai\DbConsole\Console\DoctorCommand;
use Phattarachai\DbConsole\Console\PruneCommand;
use Phattarachai\DbConsole\Http\Middleware\ApplyLocale;
use Phattarachai\DbConsole\Http\Middleware\Authorize;

final class DbConsoleServiceProvider extends ServiceProvider
{
    #[Override]
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/db-console.php', 'db-console');
    }

    public function boot(): void
    {
        $this->loadTranslationsFrom(__DIR__.'/../lang', 'db-console');
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');

        if ((bool) config('db-console.enabled', default: true)) {
            $this->registerRoutes();
        }

        if ($this->app->runningInConsole()) {
            $this->registerPublishing();
            $this->commands([DoctorCommand::class, PruneCommand::class]);
            $this->registerSchedule();
        }
    }

    private function registerRoutes(): void
    {
        Route::group([
            'domain' => config('db-console.domain'),
            'prefix' => config('db-console.path', 'db-console'),
            'middleware' => [...(array) config('db-console.middleware', ['web']), ApplyLocale::class, Authorize::class],
            'as' => 'db-console.',
        ], fn () => $this->loadRoutesFrom(__DIR__.'/../routes/web.php'));
    }

    private function registerPublishing(): void
    {
        $this->publishes([
            __DIR__.'/../config/db-console.php' => config_path('db-console.php'),
        ], 'db-console-config');

        $this->publishes([
            __DIR__.'/../database/migrations' => database_path('migrations'),
        ], 'db-console-migrations');

        $this->publishes([
            __DIR__.'/../lang' => lang_path('vendor/db-console'),
        ], 'db-console-lang');

        // Only the page needs to live in the host tree — `app.jsx`'s import.meta.glob
        // never leaves ./pages. The module itself is reached through the
        // `@db-console` Vite alias, so there is no second copy to drift.
        $this->publishes([
            __DIR__.'/../resources/js/pages/DbConsole.jsx' => resource_path('js/pages/DbConsole.jsx'),
        ], 'db-console-inertia');
    }

    private function registerSchedule(): void
    {
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            if (config('db-console.history.store') === 'database') {
                $schedule->command('db-console:prune')->daily();
            }
        });
    }
}
