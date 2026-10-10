<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support\Dialects;

use Closure;
use Illuminate\Database\Connection as DatabaseConnection;
use PDO;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Throwable;

/**
 * MySQL 8 and MariaDB.
 *
 * A read runs in `START TRANSACTION READ ONLY` (set with `SET TRANSACTION READ
 * ONLY` just before it begins); InnoDB refuses any write to a non-temporary
 * table there with error 1792, and the transaction is always rolled back.
 *
 * The timeout is a session variable on both, so it is set before the statement
 * and put back afterwards — the connection belongs to the host app:
 *
 * - MySQL's `max_execution_time` (ms) bounds SELECT only. A write is bounded by
 *   `innodb_lock_wait_timeout` (whole seconds) instead, which stops it waiting
 *   on row locks but not a long scan; see the README.
 * - MariaDB's `max_statement_time` (seconds) bounds every statement, reads and
 *   writes alike.
 *
 * Estimates come from `information_schema.TABLES.TABLE_ROWS`, which InnoDB
 * samples and MySQL caches (`information_schema_stats_expiry`), so they are
 * approximate and can lag.
 */
final class MySqlDialect extends Dialect
{
    public function __construct(private readonly bool $maria = false) {}

    public function name(): string
    {
        return $this->maria ? 'mariadb' : 'mysql';
    }

    public function serverLabel(DatabaseConnection $db): string
    {
        $version = $this->serverVersion($db);

        if (! $this->maria) {
            return 'MySQL '.$version;
        }

        // MariaDB may report `5.5.5-11.4.2-MariaDB-…` to old clients.
        return 'MariaDB '.(preg_match('/(\d+\.\d+\.\d+)-MariaDB/i', $version, $match) ? $match[1] : $version);
    }

    public function defaultSchema(DatabaseConnection $db): string
    {
        return $db->getDatabaseName();
    }

    public function read(DatabaseConnection $db, int $timeout, Closure $callback): mixed
    {
        // Transaction characteristics can't change inside an open transaction,
        // and a savepoint would inherit the outer one's read-write mode.
        if ($db->transactionLevel() > 0) {
            throw new SqlGuardException((string) __('db-console::guard.open_transaction'));
        }

        $restore = $this->setSession($db, $this->maria
            ? ['max_statement_time' => $timeout / 1000]
            : ['max_execution_time' => $timeout]);

        try {
            $db->statement('SET TRANSACTION READ ONLY');
            $db->beginTransaction();

            try {
                return $callback();
            } finally {
                $this->rollBackQuietly($db);
            }
        } finally {
            $restore();
        }
    }

    public function write(DatabaseConnection $db, int $timeout, Closure $callback): mixed
    {
        $restore = $this->setSession($db, $this->maria
            ? ['max_statement_time' => $timeout / 1000]
            : ['innodb_lock_wait_timeout' => max(1, (int) ceil($timeout / 1000))]);

        try {
            $db->beginTransaction();

            try {
                $result = $callback();

                $db->commit();

                return $result;
            } catch (Throwable $throwable) {
                $this->rollBackQuietly($db);

                throw $throwable;
            }
        } finally {
            $restore();
        }
    }

    public function estimates(DatabaseConnection $db, string $schema): array
    {
        $rows = $db->select(
            'SELECT table_name AS name, table_rows AS estimate FROM information_schema.tables WHERE table_schema = ?',
            [$schema],
        );

        $estimates = [];

        foreach ($rows as $row) {
            $estimates[(string) $row->name] = (int) ($row->estimate ?? 0);
        }

        return $estimates;
    }

    public function rowEstimate(DatabaseConnection $db, string $schema, string $table): int
    {
        return (int) ($db->selectOne(
            'SELECT table_rows AS estimate FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
            [$schema, $table],
        )->estimate ?? 0);
    }

    public function kindOf(DatabaseConnection $db, string $schema, string $name): ?string
    {
        $type = $db->selectOne(
            'SELECT table_type AS kind FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
            [$schema, $name],
        )?->kind;

        return match (true) {
            $type === null => null,
            str_contains(strtoupper((string) $type), 'VIEW') => 'view',
            default => 'table',
        };
    }

    /**
     * MySQL draws the plan as an indented tree (`FORMAT=TREE`, 8.0.16+), which
     * reads like Postgres's. MariaDB has no tree format, so its classic tabular
     * EXPLAIN is laid out as a fixed-width table, as the `mysql` client prints it.
     */
    public function explain(DatabaseConnection $db, string $sql): array
    {
        if (! $this->maria) {
            $statement = $this->prepare($db, 'EXPLAIN FORMAT=TREE '.$sql);
            $statement->execute();

            $lines = [];

            foreach ($statement->fetchAll(PDO::FETCH_COLUMN, 0) as $cell) {
                array_push($lines, ...explode("\n", rtrim((string) $cell)));
            }

            return $lines;
        }

        $statement = $this->prepare($db, 'EXPLAIN '.$sql);
        $statement->execute();

        return $this->table($statement->fetchAll(PDO::FETCH_ASSOC));
    }

    public function caseInsensitiveMatch(string $wrappedColumn): string
    {
        return "{$wrappedColumn} like";
    }

    /**
     * MariaDB 10.5+ has `INSERT .. RETURNING`, MySQL has none; both take the
     * insert-then-select path so one code path is tested on both.
     */
    public function supportsReturning(): bool
    {
        return false;
    }

    public function displayType(string $native): string
    {
        return match (strtoupper($native)) {
            'TINY' => 'tinyint',
            'SHORT' => 'smallint',
            'INT24' => 'mediumint',
            'LONG' => 'int',
            'LONGLONG' => 'bigint',
            'NEWDECIMAL', 'DECIMAL' => 'decimal',
            'FLOAT' => 'float',
            'DOUBLE' => 'double',
            'VAR_STRING' => 'varchar',
            'STRING' => 'char',
            'BLOB' => 'text',
            'NEWDATE' => 'date',
            default => strtolower($native),
        };
    }

    public function quoteIdentifier(string $identifier): string
    {
        return '`'.str_replace('`', '``', $identifier).'`';
    }

    /**
     * A server-side prepared statement holds one statement only, whatever
     * `PDO::MYSQL_ATTR_MULTI_STATEMENTS` the host connected with.
     */
    protected function singleStatementOptions(): array
    {
        return [PDO::ATTR_EMULATE_PREPARES => false];
    }

    /**
     * Set session variables and return the closure that puts the previous
     * values back. Values are numbers computed here, never request input.
     *
     * @param  array<string, int|float>  $variables
     * @return Closure(): void
     */
    private function setSession(DatabaseConnection $db, array $variables): Closure
    {
        $previous = [];

        foreach ($variables as $name => $value) {
            $previous[$name] = $db->selectOne("SELECT @@SESSION.{$name} AS value")?->value;
            $db->statement("SET SESSION {$name} = {$value}");
        }

        return function () use ($db, $previous): void {
            foreach ($previous as $name => $value) {
                if (is_numeric($value)) {
                    $db->statement("SET SESSION {$name} = {$value}");
                }
            }
        };
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<string>
     */
    private function table(array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $columns = array_keys($rows[0]);
        $cell = fn (mixed $value): string => $value === null ? 'NULL' : (string) $value;
        $widths = [];

        foreach ($columns as $column) {
            $widths[$column] = max(mb_strlen($column), ...array_map(fn (array $row): int => mb_strlen($cell($row[$column])), $rows));
        }

        $line = fn (array $values): string => '| '.implode(' | ', array_map(
            fn (string $column): string => $values[$column].str_repeat(' ', $widths[$column] - mb_strlen($values[$column])),
            $columns,
        )).' |';
        $rule = '+'.implode('+', array_map(fn (string $column): string => str_repeat('-', $widths[$column] + 2), $columns)).'+';

        return [
            $rule,
            $line(array_combine($columns, $columns)),
            $rule,
            ...array_map(fn (array $row): string => $line(array_map($cell, $row)), $rows),
            $rule,
        ];
    }
}
