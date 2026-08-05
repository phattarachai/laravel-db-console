<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Connection as DatabaseConnection;
use PDO;
use PDOException;
use PDOStatement;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Throwable;

/**
 * Runs one guarded statement on a resolved connection.
 *
 * A read runs inside a `READ ONLY` transaction that is always rolled back, so
 * Postgres itself refuses any write the guard somehow let through. A write runs
 * in a plain transaction that commits only when nothing threw. EXPLAIN is always
 * a read, never ANALYZE.
 *
 * @phpstan-type DcSqlColumn array{name: string, type: string}
 */
final readonly class SqlRunner
{
    public function __construct(private Connection $connection) {}

    /**
     * Classify without running, so the caller can demand a confirmation before a
     * write ever reaches the database.
     *
     * @return 'read'|'write'
     */
    public function kind(string $sql): string
    {
        return new SqlGuard($this->connection)->classify($sql);
    }

    /**
     * @return array{kind: string, columns?: list<DcSqlColumn>, rows?: list<array<string, mixed>>, elapsedMs: int, truncated?: bool, rowsAffected?: int}
     */
    public function run(string $sql): array
    {
        return match (new SqlGuard($this->connection)->classify($sql)) {
            'write' => $this->runWrite($sql),
            default => $this->runRead($sql),
        };
    }

    /**
     * @return array{kind: 'explain', plan: list<string>, elapsedMs: int}
     */
    public function explain(string $sql): array
    {
        new SqlGuard($this->connection)->classify($sql);

        $db = $this->connection->db();
        $startedAt = hrtime(as_number: true);

        $db->beginTransaction();

        try {
            $db->statement('SET TRANSACTION READ ONLY');
            $db->statement('SET LOCAL statement_timeout = '.$this->connection->timeout);

            $statement = $this->query($db, 'EXPLAIN '.$sql);

            return [
                'kind' => 'explain',
                'plan' => array_map(
                    fn (mixed $line): string => (string) $line,
                    array_values($statement->fetchAll(PDO::FETCH_COLUMN, 0)),
                ),
                'elapsedMs' => $this->elapsedSince($startedAt),
            ];
        } catch (PDOException $exception) {
            throw $this->wrap($exception);
        } finally {
            $this->rollBackQuietly($db);
        }
    }

    /**
     * @return array{kind: 'read', columns: list<DcSqlColumn>, rows: list<array<string, mixed>>, elapsedMs: int, truncated: bool}
     */
    private function runRead(string $sql): array
    {
        $db = $this->connection->db();
        $startedAt = hrtime(as_number: true);

        $db->beginTransaction();

        try {
            $db->statement('SET TRANSACTION READ ONLY');
            $db->statement('SET LOCAL statement_timeout = '.$this->connection->timeout);

            $statement = $this->query($db, $sql);

            [$rows, $truncated] = $this->rows($statement);

            return [
                'kind' => 'read',
                'columns' => $this->columns($statement),
                'rows' => $this->connection->redactor()->maskRows($rows),
                'elapsedMs' => $this->elapsedSince($startedAt),
                'truncated' => $truncated,
            ];
        } catch (PDOException $exception) {
            throw $this->wrap($exception);
        } finally {
            $this->rollBackQuietly($db);
        }
    }

    /**
     * @return array{kind: 'write', rowsAffected: int, elapsedMs: int}
     */
    private function runWrite(string $sql): array
    {
        $db = $this->connection->db();
        $startedAt = hrtime(as_number: true);

        $db->beginTransaction();

        try {
            $db->statement('SET LOCAL statement_timeout = '.$this->connection->timeout);

            $affected = $db->getPdo()->exec($sql);

            $db->commit();

            return [
                'kind' => 'write',
                'rowsAffected' => (int) $affected,
                'elapsedMs' => $this->elapsedSince($startedAt),
            ];
        } catch (PDOException $exception) {
            $this->rollBackQuietly($db);

            throw $this->wrap($exception);
        } catch (Throwable $throwable) {
            $this->rollBackQuietly($db);

            throw $throwable;
        }
    }

    private function query(DatabaseConnection $db, string $sql): PDOStatement
    {
        $statement = $db->getPdo()->query($sql);

        if (! $statement instanceof PDOStatement) {
            throw new SqlGuardException(__('db-console::guard.failed'));
        }

        return $statement;
    }

    /**
     * @return list<DcSqlColumn>
     */
    private function columns(PDOStatement $statement): array
    {
        $columns = [];

        for ($i = 0, $count = $statement->columnCount(); $i < $count; $i++) {
            $meta = $statement->getColumnMeta($i) ?: [];
            $columns[] = [
                'name' => $meta['name'] ?? 'column_'.$i,
                'type' => $this->displayType((string) ($meta['native_type'] ?? 'text')),
            ];
        }

        return $columns;
    }

    /**
     * Fetch up to the connection's `max_rows`; a further available row flips `truncated`.
     *
     * @return array{0: list<array<string, mixed>>, 1: bool}
     */
    private function rows(PDOStatement $statement): array
    {
        $rows = [];
        $truncated = false;

        while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
            if (count($rows) >= $this->connection->maxRows) {
                $truncated = true;
                break;
            }

            $rows[] = $this->normalizeRow($row);
        }

        return [$rows, $truncated];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        return array_map(fn (mixed $value): mixed => is_resource($value) ? '[binary]' : $value, $row);
    }

    /** Friendlier names for the Postgres native types PDO reports. */
    private function displayType(string $native): string
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

    private function elapsedSince(float|int $startedAt): int
    {
        return (int) round((hrtime(as_number: true) - $startedAt) / 1_000_000);
    }

    private function wrap(PDOException $exception): SqlGuardException
    {
        return new SqlGuardException($this->cleanMessage($exception), (int) $exception->getCode(), previous: $exception);
    }

    /** Strip the "SQLSTATE[..]: .." driver prefix so the console shows just the message. */
    private function cleanMessage(PDOException $exception): string
    {
        $message = preg_replace('/^SQLSTATE\[[^\]]+\]:?\s*/', '', $exception->getMessage()) ?? $exception->getMessage();

        return trim($message) === '' ? (string) __('db-console::guard.failed') : trim($message);
    }

    private function rollBackQuietly(DatabaseConnection $db): void
    {
        try {
            $db->rollBack();
        } catch (Throwable) {
            // The transaction may already be aborted (e.g. after a statement error).
        }
    }
}
