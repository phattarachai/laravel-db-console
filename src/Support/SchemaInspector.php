<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Schema\Builder;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;

/**
 * Live Postgres introspection for the Database Console — builds the payload the
 * schema tree and grid consume, with hidden tables dropped and masked columns
 * replaced before anything leaves the server.
 *
 * @phpstan-type DcColumn array{name: string, type: string, nullable: bool, pk: bool, fk: string|null, default: string|null}
 * @phpstan-type DcIndex array{name: string, type: string, columns: list<string>}
 * @phpstan-type DcForeignKey array{name: string, columns: list<string>, references: string, onDelete: string, onUpdate: string}
 * @phpstan-type DcTable array{name: string, type: string, rowCount: int, columns: list<DcColumn>, indexes: list<DcIndex>, foreignKeys: list<DcForeignKey>, rows: list<array<string, mixed>>}
 * @phpstan-type DcTreeEntry array{name: string, type: string, rowCount: int}
 */
final readonly class SchemaInspector
{
    /** How many exact `count(*)` selects are folded into one UNION ALL statement. */
    private const int COUNT_BATCH = 50;

    private Redactor $redactor;

    public function __construct(private Connection $connection)
    {
        $this->redactor = $connection->redactor();
    }

    /**
     * The sidebar tree: object names, kind and row count, and nothing else.
     *
     * Deliberately shallow. Columns, indexes, foreign keys and the row sample are
     * six queries and a few hundred KB *per object* — on a 150-table database that
     * is ~800 queries and megabytes of JSON before the viewer has clicked anything.
     * They are fetched one table at a time by {@see details()} instead, which keeps
     * opening the console at a fixed handful of queries whatever the schema size.
     *
     * @return list<array{name: string, tables: list<DcTreeEntry>}>
     */
    public function tree(): array
    {
        return array_map(fn (string $schema): array => [
            'name' => $schema,
            'tables' => $this->treeObjects($schema),
        ], $this->connection->schemas);
    }

    /**
     * One object in full — what {@see tree()} left out, for the table the console
     * has just selected.
     *
     * @return DcTable
     */
    public function details(string $schema, string $name): array
    {
        $this->assertSchema($schema);
        $this->redactor->assertVisible($name);

        return $this->object($schema, $name, $this->kindOf($schema, $name));
    }

    /**
     * The column list and primary key of a single table, for validating a row edit.
     *
     * @return array{columns: list<DcColumn>, primaryKey: list<string>}
     */
    public function table(string $schema, string $name): array
    {
        $this->redactor->assertVisible($name);

        $qualified = $this->qualify($schema, $name);
        $indexes = $this->schema()->getIndexes($qualified);
        $primaryKey = $this->primaryColumns($indexes);

        return [
            'columns' => $this->columns($qualified, $primaryKey, $this->foreignKeyMap($this->schema()->getForeignKeys($qualified))),
            'primaryKey' => $primaryKey,
        ];
    }

    /**
     * @return list<DcTreeEntry>
     */
    private function treeObjects(string $schema): array
    {
        $tables = array_column($this->inSchema($this->schema()->getTables(), $schema), 'name');
        $views = array_column($this->inSchema($this->schema()->getViews(), $schema), 'name');

        $counts = $this->rowCounts($schema, $tables, $views);

        $entry = fn (string $type): callable => fn (string $name): array => [
            'name' => $name,
            'type' => $type,
            'rowCount' => $counts[$name] ?? 0,
        ];

        return [...array_map($entry('table'), $tables), ...array_map($entry('view'), $views)];
    }

    /**
     * Row counts for a whole schema in at most two round trips: the planner's
     * estimate for everything, then one batched `count(*)` for the tables it has
     * no estimate for (never analysed, or genuinely empty).
     *
     * Views keep the old behaviour of reporting 0 rather than being counted — a
     * view's count is the cost of running it.
     *
     * @param  list<string>  $tables
     * @param  list<string>  $views
     * @return array<string, int>
     */
    private function rowCounts(string $schema, array $tables, array $views): array
    {
        $estimates = $this->estimates($schema);

        $counts = [];
        $uncounted = [];

        foreach ([...$tables, ...$views] as $name) {
            $counts[$name] = max(0, $estimates[$name] ?? 0);

            if ($counts[$name] === 0 && in_array($name, $tables, strict: true)) {
                $uncounted[] = $name;
            }
        }

        return [...$counts, ...$this->exactCounts($schema, $uncounted)];
    }

    /**
     * Every relation's planner row estimate, in one catalog query. Postgres 14+
     * reports -1 for a relation that has never been analysed.
     *
     * @return array<string, int>
     */
    private function estimates(string $schema): array
    {
        $rows = $this->connection->db()->select(
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

    /**
     * @param  list<string>  $names
     * @return array<string, int>
     */
    private function exactCounts(string $schema, array $names): array
    {
        $counts = [];

        foreach (array_chunk($names, self::COUNT_BATCH) as $chunk) {
            $selects = array_map(
                fn (string $name): string => 'SELECT ? AS name, count(*) AS total FROM '.$this->quoteQualified($schema, $name),
                $chunk,
            );

            foreach ($this->connection->db()->select(implode(' UNION ALL ', $selects), $chunk) as $row) {
                $counts[(string) $row->name] = (int) $row->total;
            }
        }

        return $counts;
    }

    /**
     * `table` or `view`, read from the catalog rather than trusted from the
     * request — a materialised view is a view here too.
     */
    private function kindOf(string $schema, string $name): string
    {
        $kind = $this->connection->db()->selectOne(
            'SELECT c.relkind FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ? AND c.relname = ?',
            [$schema, $name],
        )?->relkind;

        if ($kind === null) {
            throw new SqlGuardException((string) __('db-console::guard.unknown_table', ['table' => $name]));
        }

        return in_array($kind, ['v', 'm'], strict: true) ? 'view' : 'table';
    }

    /**
     * A schema the connection was never configured to browse is off limits, the
     * same way a hidden table is — `schemas` is a whitelist, not a default.
     */
    private function assertSchema(string $schema): void
    {
        if (! in_array($schema, $this->connection->schemas, strict: true)) {
            throw new SqlGuardException((string) __('db-console::guard.unknown_schema', ['schema' => $schema]));
        }
    }

    /**
     * @param  list<array{name: string, schema?: string|null}>  $objects
     * @return list<array{name: string, schema?: string|null}>
     */
    private function inSchema(array $objects, string $schema): array
    {
        return array_values(array_filter(
            $objects,
            fn (array $object): bool => ($object['schema'] ?? $schema) === $schema && ! $this->redactor->isHiddenTable($object['name']),
        ));
    }

    private function object(string $schema, string $name, string $type): array
    {
        $qualified = $this->qualify($schema, $name);
        $indexes = $this->schema()->getIndexes($qualified);
        $foreignKeys = $this->schema()->getForeignKeys($qualified);

        return [
            'name' => $name,
            'type' => $type,
            'rowCount' => $this->rowCount($schema, $name, $type),
            'columns' => $this->columns($qualified, $this->primaryColumns($indexes), $this->foreignKeyMap($foreignKeys)),
            'indexes' => $this->indexes($indexes),
            'foreignKeys' => $this->foreignKeys($foreignKeys),
            'rows' => $this->sampleRows($schema, $name),
        ];
    }

    /**
     * @param  list<string>  $primaryColumns
     * @param  array<string, string>  $foreignKeyMap
     * @return list<DcColumn>
     */
    private function columns(string $table, array $primaryColumns, array $foreignKeyMap): array
    {
        return array_map(fn (array $column): array => [
            'name' => $column['name'],
            'type' => $column['type'],
            'nullable' => (bool) $column['nullable'],
            'pk' => in_array($column['name'], $primaryColumns, strict: true),
            'fk' => $foreignKeyMap[$column['name']] ?? null,
            'default' => $this->normalizeDefault($column['default']),
        ], $this->schema()->getColumns($table));
    }

    private function normalizeDefault(?string $default): ?string
    {
        return ($default === null || $default === '') ? null : $default;
    }

    /**
     * @param  list<array{name: string, columns: list<string>, type: string, unique: bool, primary: bool}>  $indexes
     * @return list<DcIndex>
     */
    private function indexes(array $indexes): array
    {
        return array_map(fn (array $index): array => [
            'name' => $index['name'],
            'type' => $this->indexType($index),
            'columns' => $index['columns'],
        ], $indexes);
    }

    /**
     * @param  array{type: string, unique: bool, primary: bool}  $index
     */
    private function indexType(array $index): string
    {
        return match (true) {
            (bool) $index['primary'] => 'PRIMARY',
            (bool) $index['unique'] => 'UNIQUE',
            $index['type'] === 'gin' => 'GIN',
            default => 'INDEX',
        };
    }

    /**
     * @param  list<array{columns: list<string>, primary: bool}>  $indexes
     * @return list<string>
     */
    private function primaryColumns(array $indexes): array
    {
        $primary = array_values(array_filter($indexes, fn (array $index): bool => (bool) $index['primary']));

        return $primary === [] ? [] : array_merge(...array_map(fn (array $index): array => $index['columns'], $primary));
    }

    /**
     * @param  list<array{columns: list<string>, foreign_table: string, foreign_columns: list<string>}>  $foreignKeys
     * @return array<string, string>
     */
    private function foreignKeyMap(array $foreignKeys): array
    {
        $map = [];

        foreach ($foreignKeys as $foreignKey) {
            $map[$foreignKey['columns'][0]] = $foreignKey['foreign_table'].'.'.$foreignKey['foreign_columns'][0];
        }

        return $map;
    }

    /**
     * @param  list<array{name: string, columns: list<string>, foreign_table: string, foreign_columns: list<string>, on_update: string, on_delete: string}>  $foreignKeys
     * @return list<DcForeignKey>
     */
    private function foreignKeys(array $foreignKeys): array
    {
        return array_map(fn (array $foreignKey): array => [
            'name' => $foreignKey['name'],
            'columns' => $foreignKey['columns'],
            'references' => $foreignKey['foreign_table'].'.'.$foreignKey['foreign_columns'][0],
            'onDelete' => strtoupper($foreignKey['on_delete']),
            'onUpdate' => strtoupper($foreignKey['on_update']),
        ], $foreignKeys);
    }

    private function rowCount(string $schema, string $table, string $type): int
    {
        $estimate = (int) ($this->connection->db()->selectOne('SELECT reltuples::bigint AS estimate FROM pg_class WHERE oid = to_regclass(?)',
            ["{$schema}.{$table}"])?->estimate ?? 0);

        return match (true) {
            $estimate > 0 => $estimate,
            $type === 'view' => 0,
            default => $this->connection->db()->table($this->qualify($schema, $table))->count(),
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function sampleRows(string $schema, string $table): array
    {
        $rows = $this->connection->db()->table($this->qualify($schema, $table))->limit($this->connection->sampleRows)->get()
            ->map(fn (object $row): array => $this->normalizeRow((array) $row))
            ->all();

        return $this->redactor->maskRows($rows);
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
     * what they were before multi-schema support.
     */
    private function qualify(string $schema, string $table): string
    {
        return $schema === 'public' ? $table : "{$schema}.{$table}";
    }

    /**
     * Identifier-quoted `"schema"."table"`, for the one place a statement is
     * assembled as a string instead of through the query builder.
     */
    private function quoteQualified(string $schema, string $table): string
    {
        $quote = fn (string $identifier): string => '"'.str_replace('"', '""', $identifier).'"';

        return $quote($schema).'.'.$quote($table);
    }

    private function schema(): Builder
    {
        return $this->connection->db()->getSchemaBuilder();
    }
}
