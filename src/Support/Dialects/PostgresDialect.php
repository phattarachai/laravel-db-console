<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support\Dialects;

use Closure;
use Illuminate\Database\Connection as DatabaseConnection;
use PDO;
use Pdo\Pgsql;
use Throwable;

/**
 * PostgreSQL: `SET TRANSACTION READ ONLY` plus `SET LOCAL statement_timeout`,
 * both scoped to the transaction, so nothing leaks into the host's session.
 * Estimates come from `pg_class.reltuples`.
 */
final class PostgresDialect extends Dialect
{
    public function name(): string
    {
        return 'pgsql';
    }

    public function serverLabel(DatabaseConnection $db): string
    {
        return 'PostgreSQL '.$this->serverVersion($db);
    }

    public function defaultSchema(DatabaseConnection $db): string
    {
        return 'public';
    }

    public function read(DatabaseConnection $db, int $timeout, Closure $callback): mixed
    {
        $db->beginTransaction();

        try {
            $db->statement('SET TRANSACTION READ ONLY');
            $db->statement('SET LOCAL statement_timeout = '.$timeout);

            return $callback();
        } finally {
            $this->rollBackQuietly($db);
        }
    }

    public function write(DatabaseConnection $db, int $timeout, Closure $callback): mixed
    {
        $db->beginTransaction();

        try {
            $db->statement('SET LOCAL statement_timeout = '.$timeout);

            $result = $callback();

            $db->commit();

            return $result;
        } catch (Throwable $throwable) {
            $this->rollBackQuietly($db);

            throw $throwable;
        }
    }

    /**
     * Postgres 14+ reports -1 for a relation that has never been analysed.
     */
    public function estimates(DatabaseConnection $db, string $schema): array
    {
        $rows = $db->select(
            'SELECT c.relname AS name, c.reltuples::bigint AS estimate
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ?',
            [$schema],
        );

        $estimates = [];

        foreach ($rows as $row) {
            $estimates[(string) $row->name] = (int) $row->estimate;
        }

        return $estimates;
    }

    public function rowEstimate(DatabaseConnection $db, string $schema, string $table): int
    {
        return (int) ($db->selectOne(
            'SELECT reltuples::bigint AS estimate FROM pg_class WHERE oid = to_regclass(?)',
            [$this->quoteQualified($schema, $table)],
        )->estimate ?? 0);
    }

    /** A materialised view is a view here too. */
    public function kindOf(DatabaseConnection $db, string $schema, string $name): ?string
    {
        $kind = $db->selectOne(
            'SELECT c.relkind FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ? AND c.relname = ?',
            [$schema, $name],
        )?->relkind;

        return match (true) {
            $kind === null => null,
            in_array($kind, ['v', 'm'], strict: true) => 'view',
            default => 'table',
        };
    }

    public function explain(DatabaseConnection $db, string $sql): array
    {
        $statement = $this->prepare($db, 'EXPLAIN '.$sql);
        $statement->execute();

        return array_map(
            fn (mixed $line): string => (string) $line,
            array_values($statement->fetchAll(PDO::FETCH_COLUMN, 0)),
        );
    }

    public function caseInsensitiveMatch(string $wrappedColumn): string
    {
        return "{$wrappedColumn}::text ilike";
    }

    public function supportsReturning(): bool
    {
        return true;
    }

    public function displayType(string $native): string
    {
        return match (strtolower($native)) {
            'int2' => 'smallint',
            'int4' => 'integer',
            'int8' => 'bigint',
            'float4' => 'real',
            'float8' => 'double precision',
            'bool' => 'boolean',
            'bpchar' => 'char',
            default => strtolower($native),
        };
    }

    public function quoteIdentifier(string $identifier): string
    {
        return '"'.str_replace('"', '""', $identifier).'"';
    }

    /**
     * `PQexecParams` runs exactly one command and needs no named prepared
     * statement, so this also works behind a transaction-pooling PgBouncer.
     */
    protected function singleStatementOptions(): array
    {
        return [PDO::ATTR_EMULATE_PREPARES => false, Pgsql::ATTR_DISABLE_PREPARES => true];
    }
}
