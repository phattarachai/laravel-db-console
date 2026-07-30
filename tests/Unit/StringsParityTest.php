<?php

declare(strict_types=1);

it('keeps the JS string defaults and the lang files in key parity', function (): void {
    $source = (string)file_get_contents(__DIR__ . '/../../resources/js/db-console/strings.js');
    $body = substr($source, (int)strpos($source, 'DEFAULT_STRINGS'), (int)strpos($source, 'StringsContext'));

    preg_match_all("/'((?:[a-z][A-Za-z]*)(?:\.[A-Za-z_]+)+)':/", $body, $matches);
    $jsKeys = array_unique($matches[1]);

    $en = array_keys(require __DIR__ . '/../../lang/en/ui.php');
    $th = array_keys(require __DIR__ . '/../../lang/th/ui.php');

    expect(array_diff($jsKeys, $en))->toBe([], 'keys in strings.js but missing from lang/en/ui.php')
        ->and(array_diff($en, $jsKeys))->toBe([], 'keys in lang/en/ui.php with no matching string in strings.js')
        ->and(array_diff($en, $th))->toBe([], 'keys missing from lang/th/ui.php');
});

it('leaves no Thai copy inside the portable JS module', function (): void {
    $files = glob(__DIR__ . '/../../resources/js/db-console/*.js*') ?: [];

    foreach ($files as $file) {
        expect(preg_match('/[\x{0E00}-\x{0E7F}]/u', (string)file_get_contents($file)))
            ->toBe(0, basename((string)$file) . ' still contains Thai copy — it belongs in lang/th/ui.php');
    }
});
