<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Exceptions;

use RuntimeException;

/**
 * Thrown before any query runs when a configured connection is not PostgreSQL,
 * MySQL or MariaDB.
 *
 * The message names both the connection and the driver on purpose: someone
 * pointing this at a SQLite or SQL Server connection should understand why in
 * one read, rather than meeting a stack trace from a catalog query.
 */
final class UnsupportedDriverException extends RuntimeException
{
    public static function for(string $connection, string $driver): self
    {
        return new self(sprintf(
            'DB Console supports PostgreSQL, MySQL and MariaDB. Connection [%s] uses driver [%s].',
            $connection,
            $driver,
        ));
    }

    public static function unknown(string $connection): self
    {
        return new self(sprintf(
            'DB Console cannot resolve connection [%s] — it is not defined in config/database.php.',
            $connection,
        ));
    }

    public static function notConfigured(string $key): self
    {
        return new self(sprintf(
            'DB Console has no connection [%s] in config/db-console.php.',
            $key,
        ));
    }
}
