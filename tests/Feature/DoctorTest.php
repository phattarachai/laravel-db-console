<?php

declare(strict_types=1);

use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

/*
 * The doctor reads the host's frontend files, so each test points the app at a
 * throwaway tree shaped like the host it imitates.
 */

beforeEach(function (): void {
    $this->original = base_path();
    $this->host = sys_get_temp_dir().'/dc-doctor-'.Str::random(8);

    File::ensureDirectoryExists($this->host.'/resources/js/pages');
    File::ensureDirectoryExists($this->host.'/resources/js/types');
    app()->setBasePath($this->host);
});

afterEach(function (): void {
    app()->setBasePath($this->original);
    File::deleteDirectory($this->host);
});

/**
 * @param  'jsx'|'tsx'  $language
 */
function dcHost(string $root, string $language, bool $alias = true, bool $page = true): void
{
    $package = __DIR__.'/../../resources/js';
    $vite = $alias ? "resolve: { alias: { '@db-console': 'vendor/…' } }" : '';

    File::put("{$root}/resources/js/app.{$language}", '');
    File::put($root.'/vite.config.'.($language === 'tsx' ? 'ts' : 'js'), "export default defineConfig({ {$vite} })");

    if ($page) {
        File::copy("{$package}/pages/DbConsole.{$language}", "{$root}/resources/js/pages/DbConsole.{$language}");
        File::copy("{$package}/types/db-console.d.ts", "{$root}/resources/js/types/db-console.d.ts");
    }
}

it('passes on the React starter kit: vite.config.ts and a .tsx page', function (): void {
    dcHost($this->host, 'tsx');

    $this->artisan('db-console:doctor')->assertSuccessful();
});

it('passes on a JavaScript host with vite.config.js', function (): void {
    dcHost($this->host, 'jsx');

    $this->artisan('db-console:doctor')->assertSuccessful();
});

it('finds a missing alias in vite.config.ts', function (): void {
    dcHost($this->host, 'tsx', alias: false);

    $this->artisan('db-console:doctor')
        ->expectsOutputToContain('to vite.config.ts')
        ->assertFailed();
});

it('flags a .jsx page in a TypeScript app, whose root view asks Vite for .tsx', function (): void {
    dcHost($this->host, 'tsx', page: false);
    File::copy(__DIR__.'/../../resources/js/pages/DbConsole.jsx', $this->host.'/resources/js/pages/DbConsole.jsx');

    $this->artisan('db-console:doctor')
        ->expectsOutputToContain('Found DbConsole.jsx')
        ->assertFailed();
});

it('flags a page published by an older release', function (): void {
    dcHost($this->host, 'jsx');
    File::put($this->host.'/resources/js/pages/DbConsole.jsx', "const csrfToken = document.querySelector('meta')");

    $this->artisan('db-console:doctor')
        ->expectsOutputToContain('from an older release')
        ->assertFailed();
});
