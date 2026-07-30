<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Tests;

use Illuminate\Support\Facades\Route;
use Inertia\ServiceProvider as InertiaServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;
use Override;
use Phattarachai\DbConsole\DbConsole;
use Phattarachai\DbConsole\DbConsoleServiceProvider;
use Phattarachai\DbConsole\Tests\Fixtures\DcUser;

/**
 * A minimal Laravel host for the console: Postgres, an authenticatable, a
 * `login` route to be redirected to, and an Inertia root view. Everything the
 * package assumes of its host and nothing more.
 */
abstract class TestCase extends Orchestra
{
    #[Override]
    protected function setUp(): void
    {
        parent::setUp();

        // The gate is process-global; a test that registers its own callback
        // would otherwise leak into every test that runs after it.
        DbConsole::flushAuth();
        DbConsole::auth(fn($request): bool => $request->user() !== null);
    }

    #[Override]
    protected function tearDown(): void
    {
        DbConsole::flushAuth();

        parent::tearDown();
    }

    /**
     * @return list<class-string>
     */
    #[Override]
    protected function getPackageProviders($app): array
    {
        return [InertiaServiceProvider::class, DbConsoleServiceProvider::class];
    }

    #[Override]
    protected function defineEnvironment($app): void
    {
        $config = $app['config'];

        $config->set('database.default', 'pgsql');
        $config->set('database.connections.pgsql', [
            'driver' => 'pgsql',
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'db_console_testing'),
            'username' => env('DB_USERNAME', 'postgres'),
            'password' => env('DB_PASSWORD', 'postgres'),
            'charset' => 'utf8',
            'search_path' => 'public',
            'sslmode' => 'prefer',
        ]);

        $config->set('auth.providers.users.model', DcUser::class);
        // The published page ships with the package, so `assertInertia`'s
        // "does this component exist?" check resolves without a host tree.
        $config->set('inertia.pages.paths', [__DIR__ . '/../resources/js/pages']);
        $config->set('inertia.pages.extensions', ['jsx']);
        $config->set('view.paths', [...(array)$config->get('view.paths', []), __DIR__ . '/Fixtures/views']);

        // Pin the console's own config: the shipped file is a tunable an app
        // owner edits, so the suite must not assert against whatever it says.
        $config->set('db-console.connections', ['default' => []]);
        $config->set('db-console.defaults.mode', 'read');
        $config->set('db-console.defaults.confirm_writes', value: false);
        $config->set('db-console.hidden_tables', ['db_console_*', 'dc_hidden']);
        $config->set('db-console.masked_columns', ['password', '*_token']);
    }

    protected function defineRoutes($router): void
    {
        Route::get('/login', fn(): string => 'login')->name('login');
    }

    #[Override]
    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/database/migrations');
    }
}
