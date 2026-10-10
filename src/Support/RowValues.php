<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

/**
 * Makes a fetched row safe to send as JSON. Postgres hands `bytea` back as a
 * stream and MySQL hands `BINARY`/`BLOB` back as raw bytes; neither can be
 * JSON-encoded, so both become a `[binary]` marker.
 */
final class RowValues
{
    public const string BINARY = '[binary]';

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public static function normalize(array $row): array
    {
        return array_map(self::value(...), $row);
    }

    public static function value(mixed $value): mixed
    {
        return match (true) {
            is_resource($value) => self::BINARY,
            is_string($value) && ! mb_check_encoding($value, 'UTF-8') => self::BINARY,
            default => $value,
        };
    }
}
