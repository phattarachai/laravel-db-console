<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use PDO;
use PDOException;
use PDOStatement;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;

/**
 * Runs one guarded statement on a resolved connection.
 *
 * A read runs inside a `READ ONLY` transaction that is always rolled back, so
 * the engine itself refuses any write the guard somehow let through. A write
 * runs in a plain transaction that commits only when nothing threw. EXPLAIN is
 * always a read, never ANALYZE. How each of those is done per engine lives in
 * the connection's {@see Dialects\Dialect}.
 *
 * Every statement is a single server-side prepared statement, so the engine
 * also refuses a second statement even if one got past the guard.
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
        $dialect = $this->connection->dialect();
        $startedAt = hrtime(as_number: true);

        try {
            return $dialect->read($db, $this->connection->timeout, fn (): array => [
                'kind' => 'explain',
                'plan' => $dialect->explain($db, $sql),
                'elapsedMs' => $this->elapsedSince($startedAt),
            ]);
        } catch (PDOException $exception) {
            throw $this->wrap($exception);
        }
    }

    /**
     * @return array{kind: 'read', columns: list<DcSqlColumn>, rows: list<array<string, mixed>>, elapsedMs: int, truncated: bool}
     */
    private function runRead(string $sql): array
    {
        $db = $this->connection->db();
        $dialect = $this->connection->dialect();
        $startedAt = hrtime(as_number: true);

        try {
            return $dialect->read($db, $this->connection->timeout, function () use ($db, $dialect, $sql, $startedAt): array {
                $statement = $dialect->prepare($db, $sql);
                $statement->execute();

                [$rows, $truncated] = $this->rows($statement);

                return [
                    'kind' => 'read',
                    'columns' => $this->columns($statement),
                    'rows' => $this->connection->redactor()->maskRows($rows),
                    'elapsedMs' => $this->elapsedSince($startedAt),
                    'truncated' => $truncated,
                ];
            });
        } catch (PDOException $exception) {
            throw $this->wrap($exception);
        }
    }

    /**
     * @return array{kind: 'write', rowsAffected: int, elapsedMs: int}
     */
    private function runWrite(string $sql): array
    {
        $db = $this->connection->db();
        $dialect = $this->connection->dialect();
        $startedAt = hrtime(as_number: true);

        try {
            return $dialect->write($db, $this->connection->timeout, function () use ($db, $dialect, $sql, $startedAt): array {
                $statement = $dialect->prepare($db, $sql);
                $statement->execute();

                return [
                    'kind' => 'write',
                    'rowsAffected' => $statement->rowCount(),
                    'elapsedMs' => $this->elapsedSince($startedAt),
                ];
            });
        } catch (PDOException $exception) {
            throw $this->wrap($exception);
        }
    }

    /**
     * @return list<DcSqlColumn>
     */
    private function columns(PDOStatement $statement): array
    {
        $dialect = $this->connection->dialect();
        $columns = [];

        for ($i = 0, $count = $statement->columnCount(); $i < $count; $i++) {
            $meta = $statement->getColumnMeta($i) ?: [];
            $columns[] = [
                'name' => $meta['name'] ?? 'column_'.$i,
                'type' => $dialect->displayType((string) ($meta['native_type'] ?? 'text')),
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

            $rows[] = RowValues::normalize($row);
        }

        return [$rows, $truncated];
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
}
