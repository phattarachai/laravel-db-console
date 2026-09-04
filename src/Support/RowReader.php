<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Connection as DatabaseConnection;
use Illuminate\Database\Query\Builder;
use PDOException;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Throwable;

/**
 * Server-side reads for the grid: a filtered, sorted, paginated slice of one
 * table, built from structured conditions rather than typed SQL.
 *
 * Every condition is compiled through the query builder with bindings — the
 * column is whitelisted against the table's real, non-masked columns and the
 * operator against a fixed set — so nothing the browser sends reaches SQL as
 * text. The query runs inside the same always-rolled-back READ ONLY transaction
 * as {@see SqlRunner}, so Postgres itself refuses a write even if one slipped
 * through the builder.
 *
 * Pagination is "one more than asked": the reader fetches `perPage + 1` rows and
 * reports `hasMore`, never counting the whole table — so a filter over a
 * hundred-million-row table costs a page, not a scan.
 *
 * @phpstan-type DcFilter array{column?: string, operator?: string, value?: mixed}
 * @phpstan-type DcSort array{column: string, dir: string}
 * @phpstan-type DcPage array{rows: list<array<string, mixed>>, page: int, perPage: int, hasMore: bool, elapsedMs: int}
 */
final readonly class RowReader
{
    /** Operators that take exactly one scalar value. */
    private const array SCALAR_OPERATORS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'starts', 'ends'];

    /** Operators that take a non-empty list of values. */
    private const array LIST_OPERATORS = ['in', 'nin'];

    /** Operators that take no value at all. */
    private const array NULLARY_OPERATORS = ['is_null', 'not_null', 'is_true', 'is_false'];

    /** The largest page the grid can ask for, whatever it sends. */
    private const int MAX_PER_PAGE = 200;

    public function __construct(
        private Connection $connection,
        private SchemaInspector $inspector,
    ) {}

    /**
     * @param  list<DcFilter>  $filters
     * @param  DcSort|null  $sort
     * @return DcPage
     */
    public function page(string $schema, string $table, array $filters, ?string $search, ?array $sort, int $page, int $perPage): array
    {
        $this->assertSchema($schema);

        $definition = $this->inspector->table($schema, $table);
        $columns = $this->filterableColumns($definition['columns']);

        $db = $this->connection->db();
        $query = $db->table($this->qualify($schema, $table));

        $this->applyFilters($query, $columns, $filters);
        $this->applySearch($query, $columns, $search);
        $this->applySort($query, $columns, $definition['primaryKey'], $sort);

        return $this->read($db, $query, max(1, $page), $this->clampPerPage($perPage));
    }

    /**
     * The columns a filter or search may touch: every real column except the
     * masked ones, which stay unfilterable so their values can't be recovered
     * by probing (the same line {@see RowWriter} draws for writes).
     *
     * @param  list<array{name: string, type: string, nullable: bool, pk: bool, fk: string|null, default: string|null}>  $columns
     * @return array<string, string> name => type
     */
    private function filterableColumns(array $columns): array
    {
        $redactor = $this->connection->redactor();
        $map = [];

        foreach ($columns as $column) {
            if (! $redactor->isMaskedColumn($column['name'])) {
                $map[$column['name']] = $column['type'];
            }
        }

        return $map;
    }

    /**
     * @param  array<string, string>  $columns
     * @param  list<DcFilter>  $filters
     */
    private function applyFilters(Builder $query, array $columns, array $filters): void
    {
        foreach ($filters as $filter) {
            $this->applyFilter($query, $columns, $filter);
        }
    }

    /**
     * @param  array<string, string>  $columns
     * @param  DcFilter  $filter
     */
    private function applyFilter(Builder $query, array $columns, array $filter): void
    {
        $column = (string) ($filter['column'] ?? '');
        $operator = (string) ($filter['operator'] ?? '');
        $value = $filter['value'] ?? null;

        $this->assertColumn($columns, $column);
        $this->assertOperator($operator);

        match (true) {
            in_array($operator, self::NULLARY_OPERATORS, strict: true) => $this->applyNullary($query, $column, $operator),
            in_array($operator, self::LIST_OPERATORS, strict: true) => $this->applyList($query, $column, $operator, $value),
            $operator === 'between' => $query->whereBetween($column, $this->assertPair($value)),
            default => $this->applyScalar($query, $column, $operator, $value),
        };
    }

    private function applyScalar(Builder $query, string $column, string $operator, mixed $value): void
    {
        $this->assertScalar($value);

        match ($operator) {
            'eq' => $query->where($column, '=', $value),
            'ne' => $query->where($column, '!=', $value),
            'lt' => $query->where($column, '<', $value),
            'lte' => $query->where($column, '<=', $value),
            'gt' => $query->where($column, '>', $value),
            'gte' => $query->where($column, '>=', $value),
            'contains' => $query->where($column, 'ilike', '%'.$this->escapeLike((string) $value).'%'),
            'starts' => $query->where($column, 'ilike', $this->escapeLike((string) $value).'%'),
            'ends' => $query->where($column, 'ilike', '%'.$this->escapeLike((string) $value)),
            default => throw $this->unreachable($operator),
        };
    }

    private function applyList(Builder $query, string $column, string $operator, mixed $value): void
    {
        $values = $this->assertList($value);

        match ($operator) {
            'in' => $query->whereIn($column, $values),
            'nin' => $query->whereNotIn($column, $values),
            default => throw $this->unreachable($operator),
        };
    }

    private function applyNullary(Builder $query, string $column, string $operator): void
    {
        match ($operator) {
            'is_null' => $query->whereNull($column),
            'not_null' => $query->whereNotNull($column),
            'is_true' => $query->where($column, true),
            'is_false' => $query->where($column, false),
            default => throw $this->unreachable($operator),
        };
    }

    /**
     * The category dispatch in {@see applyFilter()} routes every validated
     * operator to the matching arm, so a sub-match's default is unreachable —
     * it exists to keep each `match` total for the analyser.
     */
    private function unreachable(string $operator): SqlGuardException
    {
        return new SqlGuardException((string) __('db-console::guard.unknown_operator', ['operator' => $operator]));
    }

    /**
     * A single ILIKE across every text column, ORed together and wrapped so it
     * ANDs with the structured filters rather than widening them.
     *
     * @param  array<string, string>  $columns
     */
    private function applySearch(Builder $query, array $columns, ?string $search): void
    {
        $term = trim((string) $search);

        if ($term === '') {
            return;
        }

        $textColumns = array_keys(array_filter($columns, $this->isTextType(...)));

        if ($textColumns === []) {
            return;
        }

        $like = '%'.$this->escapeLike($term).'%';

        $query->where(function (Builder $inner) use ($textColumns, $like): void {
            foreach ($textColumns as $column) {
                $inner->orWhere($column, 'ilike', $like);
            }
        });
    }

    /**
     * @param  array<string, string>  $columns
     * @param  list<string>  $primaryKey
     * @param  DcSort|null  $sort
     */
    private function applySort(Builder $query, array $columns, array $primaryKey, ?array $sort): void
    {
        $column = $sort['column'] ?? null;
        $direction = ($sort['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc';

        if ($column !== null && array_key_exists($column, $columns)) {
            $query->orderBy($column, $direction);
        }

        foreach ($primaryKey as $key) {
            if ($key !== $column) {
                $query->orderBy($key, 'asc');
            }
        }
    }

    /**
     * @return DcPage
     */
    private function read(DatabaseConnection $db, Builder $query, int $page, int $perPage): array
    {
        $startedAt = hrtime(as_number: true);

        $query->offset(($page - 1) * $perPage)->limit($perPage + 1);

        $db->beginTransaction();

        try {
            $db->statement('SET TRANSACTION READ ONLY');
            $db->statement('SET LOCAL statement_timeout = '.$this->connection->timeout);

            $rows = $query->get()->map(fn (object $row): array => $this->normalizeRow((array) $row))->all();
            $hasMore = count($rows) > $perPage;

            return [
                'rows' => $this->connection->redactor()->maskRows(array_slice($rows, 0, $perPage)),
                'page' => $page,
                'perPage' => $perPage,
                'hasMore' => $hasMore,
                'elapsedMs' => $this->elapsedSince($startedAt),
            ];
        } catch (PDOException $exception) {
            throw new SqlGuardException($this->cleanMessage($exception), (int) $exception->getCode(), previous: $exception);
        } finally {
            $this->rollBackQuietly($db);
        }
    }

    private function assertSchema(string $schema): void
    {
        if (! in_array($schema, $this->connection->schemas, strict: true)) {
            throw new SqlGuardException((string) __('db-console::guard.unknown_schema', ['schema' => $schema]));
        }
    }

    /**
     * @param  array<string, string>  $columns
     */
    private function assertColumn(array $columns, string $column): void
    {
        if (! array_key_exists($column, $columns)) {
            throw new SqlGuardException((string) __('db-console::guard.unknown_column', ['column' => $column]));
        }
    }

    private function assertOperator(string $operator): void
    {
        $allowed = [...self::SCALAR_OPERATORS, ...self::LIST_OPERATORS, ...self::NULLARY_OPERATORS, 'between'];

        if (! in_array($operator, $allowed, strict: true)) {
            throw new SqlGuardException((string) __('db-console::guard.unknown_operator', ['operator' => $operator]));
        }
    }

    private function assertScalar(mixed $value): void
    {
        if (! is_scalar($value)) {
            throw new SqlGuardException((string) __('db-console::guard.invalid_filter_value'));
        }
    }

    /**
     * @return list<scalar>
     */
    private function assertList(mixed $value): array
    {
        $values = is_array($value) ? array_values(array_filter($value, is_scalar(...))) : [];

        if ($values === [] || count($values) > $this->connection->maxRows) {
            throw new SqlGuardException((string) __('db-console::guard.invalid_filter_value'));
        }

        return $values;
    }

    /**
     * @return array{0: scalar, 1: scalar}
     */
    private function assertPair(mixed $value): array
    {
        $pair = is_array($value) ? array_values($value) : [];

        if (count($pair) !== 2 || ! is_scalar($pair[0]) || ! is_scalar($pair[1])) {
            throw new SqlGuardException((string) __('db-console::guard.invalid_filter_value'));
        }

        return [$pair[0], $pair[1]];
    }

    /** Neutralise LIKE wildcards so a typed `%` or `_` matches literally. */
    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private function isTextType(string $type): bool
    {
        return (bool) preg_match('/char|text|uuid|citext|name/i', $type);
    }

    private function clampPerPage(int $perPage): int
    {
        return max(1, min($perPage, self::MAX_PER_PAGE, $this->connection->maxRows));
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        return array_map(fn (mixed $value): mixed => is_resource($value) ? '[binary]' : $value, $row);
    }

    /**
     * The `public` schema stays unqualified, so its queries are byte-for-byte
     * what the rest of the console runs.
     */
    private function qualify(string $schema, string $table): string
    {
        return $schema === 'public' ? $table : "{$schema}.{$table}";
    }

    private function elapsedSince(float|int $startedAt): int
    {
        return (int) round((hrtime(as_number: true) - $startedAt) / 1_000_000);
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
