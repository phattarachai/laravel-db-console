<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Phattarachai\DbConsole\DbConsole;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\Connection;
use Throwable;

/**
 * Checks the host-app requirements the console cannot work around — the driver,
 * the migrations, the routes, the published page and the Vite alias — so a failed
 * install reports what is missing instead of a blank page. The module ships its
 * own scoped CSS, so there is nothing to verify in the host's Tailwind setup.
 */
final class DoctorCommand extends Command
{
    protected $signature = 'db-console:doctor';

    protected $description = 'Check that this application satisfies the DB Console requirements.';

    public function handle(): int
    {
        $failures = 0;

        $failures += $this->check('Console enabled',
            fn (): ?string => config('db-console.enabled') ? null : 'db-console.enabled is false, so no routes are registered.');

        $failures += $this->check('Routes registered',
            fn (): ?string => Route::has('db-console.index') ? null : 'Route [db-console.index] is missing.');

        foreach (array_keys((array) config('db-console.connections', [])) as $key) {
            $failures += $this->check("Connection [{$key}]", fn (): ?string => $this->connection((string) $key));
        }

        $failures += $this->check('Tables migrated', function (): ?string {
            $missing = array_values(array_filter(
                ['db_console_queries', 'db_console_history', 'db_console_shares', 'db_console_favorites'],
                fn (string $table): bool => ! Schema::hasTable($table),
            ));

            return $missing === []
                ? null
                : 'Run `php artisan migrate` — missing: '.implode(', ', $missing).'.';
        });

        $failures += $this->check('Inertia page published', fn (): ?string => $this->page());

        $failures += $this->check('Vite alias @db-console', fn (): ?string => $this->viteConfig() !== null && $this->fileContains($this->viteConfig(), '@db-console')
            ? null
            : 'Add a resolve.alias entry for @db-console to '.($this->viteConfig() === null ? 'vite.config.js' : basename($this->viteConfig())).' — see the package README.');

        $this->newLine();

        if ($failures === 0) {
            $this->components->info('DB Console looks correctly installed.');

            return self::SUCCESS;
        }

        $this->components->error("{$failures} check(s) need attention.");

        return self::FAILURE;
    }

    /**
     * @param  callable(): (string|null)  $check
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

    /**
     * The page must exist with the extension the host's root view asks Vite
     * for, be the current version (SSR-safe, opted out of the host's default
     * layout), and match the host's language.
     */
    private function page(): ?string
    {
        $path = DbConsole::pagePath();
        $publish = 'Run `php artisan vendor:publish --tag=db-console-inertia --force`.';
        $other = resource_path('js/pages/DbConsole.'.(DbConsole::usesTypeScript() ? 'jsx' : 'tsx'));

        if (! file_exists($path)) {
            return file_exists($other)
                ? 'Found '.basename($other).', but this app\'s pages are '.pathinfo($path, PATHINFO_EXTENSION).' — delete it, then: '.$publish
                : $publish;
        }

        if (! $this->fileContains($path, 'typeof document') || ! $this->fileContains($path, '.layout')) {
            return basename($path).' is from an older release (it breaks under SSR or inside a default layout). '.$publish;
        }

        if (DbConsole::usesTypeScript() && ! file_exists(resource_path('js/types/db-console.d.ts'))) {
            return 'resources/js/types/db-console.d.ts is missing, so `tsc` cannot resolve @db-console. '.$publish;
        }

        return null;
    }

    /** `vite.config.ts` (the React starter kit), `.js`, or the `.mjs`/`.mts` variants. */
    private function viteConfig(): ?string
    {
        foreach (['ts', 'js', 'mts', 'mjs'] as $extension) {
            if (file_exists($path = base_path("vite.config.{$extension}"))) {
                return $path;
            }
        }

        return null;
    }

    private function fileContains(string $path, string $needle): bool
    {
        return file_exists($path) && str_contains((string) file_get_contents($path), $needle);
    }
}
