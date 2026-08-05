<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Connection as DatabaseConnection;
use Illuminate\Database\Query\Builder;
use PDO;
use PDOException;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Throwable;

/**
 * Single-row edits from the grid — create, update, delete — on a writable
 * connection.
 *
 * Every statement is compiled by the query builder with bindings, and an update
 * or delete that matches anything other than exactly one row is rolled back: the
 * grid edits one row, so a wider match means the primary key was wrong.
 */
final readonly class RowWriter
{
    private const array ACTIONS = ['create', 'update', 'delete'];

    public function __construct(
        private Connection $connection,
        private SchemaInspector $inspector,
    ) {}

    /**
     * @param  array<string, mixed>  $pk
     * @param  array<string, mixed>  $values
     * @return array{sql: string, affected: int, row: array<string, mixed>|null}
     */
    public function apply(string $schema, string $table, string $action, array $pk, array $values): array
    {
        $this->assertWritable($schema, $table, $action, $pk, $values);

        $db = $this->connection->db();
        $qualified = $this->qualified($schema, $table);
        [$sql, $bindings] = $this->compile($db, $qualified, $action, $pk, $values);

        $db->beginTransaction();

        try {
            $db->statement('SET LOCAL statement_timeout = '.$this->connection->timeout);

            [$affected, $row] = match ($action) {
                'create' => $this->insert($db, $qualified, $values),
                'update' => $this->change($db, $qualified, $pk, $values),
                default => $this->remove($db, $qualified, $pk),
            };

            if ($action !== 'create' && $affected !== 1) {
                throw new SqlGuardException(__('db-console::guard.affected_not_one', ['count' => $affected]));
            }

            $db->commit();

            return [
                'sql' => $this->interpolate($db, $sql, $bindings),
                'affected' => $affected,
                'row' => $row === null ? null : $this->connection->redactor()->maskRow($row),
            ];
        } catch (PDOException $exception) {
            $this->rollBackQuietly($db);

            throw new SqlGuardException($this->cleanMessage($exception), (int) $exception->getCode(), previous: $exception);
        } catch (Throwable $throwable) {
            $this->rollBackQuietly($db);

            throw $throwable;
        }
    }

    /**
     * The statement the grid is about to run, with its bindings inlined so the
     * confirm dialog can show it. Display only — never executed.
     *
     * @param  array<string, mixed>  $pk
     * @param  array<string, mixed>  $values
     */
    public function preview(string $schema, string $table, string $action, array $pk, array $values): string
    {
        $this->assertWritable($schema, $table, $action, $pk, $values);

        $db = $this->connection->db();
        [$sql, $bindings] = $this->compile($db, $this->qualified($schema, $table), $action, $pk, $values);

        return $this->interpolate($db, $sql, $bindings);
    }

    /**
     * @param  array<string, mixed>  $pk
     * @param  array<string, mixed>  $values
     */
    private function assertWritable(string $schema, string $table, string $action, array $pk, array $values): void
    {
        if (! $this->connection->isWritable()) {
            throw new SqlGuardException(__('db-console::guard.read_only_row'));
        }

        if (! in_array($action, self::ACTIONS, strict: true)) {
            throw new SqlGuardException(__('db-console::guard.failed'));
        }

        $redactor = $this->connection->redactor();
        $redactor->assertVisible($table);

        $definition = $this->inspector->table($schema, $table);

        if ($definition['primaryKey'] === []) {
            throw new SqlGuardException(__('db-console::guard.no_primary_key'));
        }

        if ($action !== 'create' && $this->sorted(array_keys($pk)) !== $this->sorted($definition['primaryKey'])) {
            throw new SqlGuardException(__('db-console::guard.pk_mismatch'));
        }

        $columns = array_column($definition['columns'], 'name');

        foreach (array_keys($values) as $column) {
            $column = (string) $column;

            if (! in_array($column, $columns, strict: true)) {
                throw new SqlGuardException(__('db-console::guard.unknown_column', ['column' => $column]));
            }

            if ($redactor->isMaskedColumn($column)) {
                throw new SqlGuardException(__('db-console::guard.masked_column', ['column' => $column]));
            }
        }
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array{0: int, 1: array<string, mixed>|null}
     */
    private function insert(DatabaseConnection $db, string $qualified, array $values): array
    {
        $rows = $db->selectFromWriteConnection(
            $this->insertSql($db->table($qualified), $values),
            array_values($values),
        );

        return [count($rows), $this->firstRow($rows)];
    }

    /**
     * @param  array<string, mixed>  $pk
     * @param  array<string, mixed>  $values
     * @return array{0: int, 1: array<string, mixed>|null}
     */
    private function change(DatabaseConnection $db, string $qualified, array $pk, array $values): array
    {
        $affected = $values === [] ? 0 : $db->table($qualified)->where($pk)->update($values);

        if ($affected !== 1) {
            return [$affected, null];
        }

        $lookup = [...$pk, ...array_intersect_key($values, $pk)];

        return [$affected, $this->firstRow($db->table($qualified)->useWritePdo()->where($lookup)->get()->all())];
    }

    /**
     * @param  array<string, mixed>  $pk
     * @return array{0: int, 1: null}
     */
    private function remove(DatabaseConnection $db, string $qualified, array $pk): array
    {
        return [$db->table($qualified)->where($pk)->delete(), null];
    }

    /**
     * @param  array<string, mixed>  $pk
     * @param  array<string, mixed>  $values
     * @return array{0: string, 1: list<mixed>}
     */
    private function compile(DatabaseConnection $db, string $qualified, string $action, array $pk, array $values): array
    {
        $query = $db->table($qualified);

        if ($action === 'create') {
            return [$this->insertSql($query, $values), array_values($values)];
        }

        $query->where($pk);
        $grammar = $query->getGrammar();

        if ($action === 'update') {
            return [
                $grammar->compileUpdate($query, $values),
                array_values($grammar->prepareBindingsForUpdate($query->getRawBindings(), $values)),
            ];
        }

        return [
            $grammar->compileDelete($query),
            array_values($grammar->prepareBindingsForDelete($query->getRawBindings())),
        ];
    }

    /**
     * `returning *` hands back the stored row — defaults and triggers included —
     * without a second round trip.
     *
     * @param  array<string, mixed>  $values
     */
    private function insertSql(Builder $query, array $values): string
    {
        $grammar = $query->getGrammar();

        return $grammar->compileInsert($query, $values === [] ? [] : [$values]).' returning *';
    }

    /**
     * @param  list<mixed>  $rows
     * @return array<string, mixed>|null
     */
    private function firstRow(array $rows): ?array
    {
        $row = $rows[0] ?? null;

        return $row === null ? null : (array) $row;
    }

    /**
     * @param  list<mixed>  $bindings
     */
    private function interpolate(DatabaseConnection $db, string $sql, array $bindings): string
    {
        $pdo = $db->getPdo();
        $parts = explode('?', $sql);
        $rendered = array_shift($parts);

        foreach ($parts as $index => $part) {
            $rendered .= $this->literal($pdo, $bindings[$index] ?? null).$part;
        }

        return $rendered;
    }

    private function literal(PDO $pdo, mixed $value): string
    {
        return match (true) {
            $value === null => 'NULL',
            is_bool($value) => $value ? 'true' : 'false',
            is_int($value), is_float($value) => (string) $value,
            default => (string) $pdo->quote((string) $value),
        };
    }

    /**
     * @param  list<mixed>  $values
     * @return list<string>
     */
    private function sorted(array $values): array
    {
        $sorted = array_map(fn (mixed $value): string => (string) $value, $values);
        sort($sorted);

        return $sorted;
    }

    private function qualified(string $schema, string $table): string
    {
        return $schema.'.'.$table;
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
