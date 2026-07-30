<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\Connection;
use Throwable;

/**
 * Checks the host-app requirements the console cannot work around — the driver,
 * the migrations, the routes, and the two build-tool wiring steps — so a failed
 * install reports what is missing instead of a blank page.
 */
final class DoctorCommand extends Command
{
    protected $signature = 'db-console:doctor';

    protected $description = 'Check that this application satisfies the DB Console requirements.';

    public function handle(): int
    {
        $failures = 0;

        $failures += $this->check('Console enabled',
            fn(): ?string => config('db-console.enabled') ? null : 'db-console.enabled is false, so no routes are registered.');

        $failures += $this->check('Routes registered',
            fn(): ?string => Route::has('db-console.index') ? null : 'Route [db-console.index] is missing.');

        foreach (array_keys((array)config('db-console.connections', [])) as $key) {
            $failures += $this->check("Connection [{$key}]", fn(): ?string => $this->connection((string)$key));
        }

        $failures += $this->check('Tables migrated',
            fn(): ?string => Schema::hasTable('db_console_queries') && Schema::hasTable('db_console_history') && Schema::hasTable('db_console_shares')
                ? null
                : 'Run `php artisan migrate` — the db_console_* tables are missing.');

        $failures += $this->check('Inertia page published', fn(): ?string => file_exists(resource_path('js/pages/DbConsole.jsx'))
            ? null
            : 'Run `php artisan vendor:publish --tag=db-console-inertia`.');

        $failures += $this->check('Vite alias @db-console', fn(): ?string => $this->fileContains(base_path('vite.config.js'), '@db-console')
            ? null
            : 'Add a resolve.alias entry for @db-console — see the package README.');

        $failures += $this->check('Tailwind prefix(tw)', fn(): ?string => $this->fileContains(resource_path('css/app.css'), 'prefix(tw)')
            ? null
            : "The module's markup needs `@import 'tailwindcss' prefix(tw);` in your Tailwind entry CSS.");

        $failures += $this->check('Tailwind @source for the package',
            fn(): ?string => $this->fileContains(resource_path('css/app.css'), 'laravel-db-console')
                ? null
                : 'Add an @source line covering the package JSX, or Tailwind will emit none of its classes.');

        $this->newLine();

        if ($failures === 0) {
            $this->components->info('DB Console looks correctly installed.');

            return self::SUCCESS;
        }

        $this->components->error("{$failures} check(s) need attention.");

        return self::FAILURE;
    }

    /**
     * @param callable(): (string|null) $check
     */
    private function check(string $label, callable $check): int
    {
        try {
            $problem = $check();
        } catch (Throwable $throwable) {
            $problem = $throwable->getMessage();
        }

        $this->components->twoColumnDetail($label, $problem === null ? '<fg=green>OK</>' : '<fg=red>FAIL</>');

        if ($problem !== null) {
            $this->line("  <fg=gray>{$problem}</>");

            return 1;
        }

        return 0;
    }

    private function connection(string $key): ?string
    {
        try {
            $payload = Connection::resolve($key)->payload();

            $this->line("  <fg=gray>{$payload['database']} · {$payload['driver']} · {$payload['mode']}</>");

            return null;
        } catch (UnsupportedDriverException $exception) {
            return $exception->getMessage();
        }
    }

    private function fileContains(string $path, string $needle): bool
    {
        return file_exists($path) && str_contains((string)file_get_contents($path), $needle);
    }
}
