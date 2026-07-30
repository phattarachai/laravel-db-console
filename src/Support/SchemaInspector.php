<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Schema\Builder;

/**
 * Live Postgres introspection for the Database Console — builds the payload the
 * schema tree and grid consume, with hidden tables dropped and masked columns
 * replaced before anything leaves the server.
 *
 * @phpstan-type DcColumn array{name: string, type: string, nullable: bool, pk: bool, fk: string|null, default: string|null}
 * @phpstan-type DcIndex array{name: string, type: string, columns: list<string>}
 * @phpstan-type DcForeignKey array{name: string, columns: list<string>, references: string, onDelete: string, onUpdate: string}
 * @phpstan-type DcTable array{name: string, type: string, rowCount: int, columns: list<DcColumn>, indexes: list<DcIndex>, foreignKeys: list<DcForeignKey>, rows: list<array<string, mixed>>}
 */
final readonly class SchemaInspector
{
    private Redactor $redactor;

    public function __construct(private Connection $connection)
    {
        $this->redactor = $connection->redactor();
    }

    /**
     * @return list<array{name: string, tables: list<DcTable>}>
     */
    public function schemas(): array
    {
        return array_map(fn(string $schema): array => [
            'name' => $schema,
            'tables' => $this->objects($schema),
        ], $this->connection->schemas);
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
     * @return list<DcTable>
     */
    private function objects(string $schema): array
    {
        $tables = array_map(fn(array $table): array => $this->object($schema, $table['name'], 'table'),
            $this->inSchema($this->schema()->getTables(), $schema));
        $views = array_map(fn(array $view): array => $this->object($schema, $view['name'], 'view'),
            $this->inSchema($this->schema()->getViews(), $schema));

        return [...$tables, ...$views];
    }

    /**
     * @param list<array{name: string, schema?: string|null}> $objects
     * @return list<array{name: string, schema?: string|null}>
     */
    private function inSchema(array $objects, string $schema): array
    {
        return array_values(array_filter(
            $objects,
            fn(array $object): bool => ($object['schema'] ?? $schema) === $schema && !$this->redactor->isHiddenTable($object['name']),
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
     * @param list<string> $primaryColumns
     * @param array<string, string> $foreignKeyMap
     * @return list<DcColumn>
     */
    private function columns(string $table, array $primaryColumns, array $foreignKeyMap): array
    {
        return array_map(fn(array $column): array => [
            'name' => $column['name'],
            'type' => $column['type'],
            'nullable' => (bool)$column['nullable'],
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
     * @param list<array{name: string, columns: list<string>, type: string, unique: bool, primary: bool}> $indexes
     * @return list<DcIndex>
     */
    private function indexes(array $indexes): array
    {
        return array_map(fn(array $index): array => [
            'name' => $index['name'],
            'type' => $this->indexType($index),
            'columns' => $index['columns'],
        ], $indexes);
    }

    /**
     * @param array{type: string, unique: bool, primary: bool} $index
     */
    private function indexType(array $index): string
    {
        return match (true) {
            (bool)$index['primary'] => 'PRIMARY',
            (bool)$index['unique'] => 'UNIQUE',
            $index['type'] === 'gin' => 'GIN',
            default => 'INDEX',
        };
    }

    /**
     * @param list<array{columns: list<string>, primary: bool}> $indexes
     * @return list<string>
     */
    private function primaryColumns(array $indexes): array
    {
        $primary = array_values(array_filter($indexes, fn(array $index): bool => (bool)$index['primary']));

        return $primary === [] ? [] : array_merge(...array_map(fn(array $index): array => $index['columns'], $primary));
    }

    /**
     * @param list<array{columns: list<string>, foreign_table: string, foreign_columns: list<string>}> $foreignKeys
     * @return array<string, string>
     */
    private function foreignKeyMap(array $foreignKeys): array
    {
        $map = [];

        foreach ($foreignKeys as $foreignKey) {
            $map[$foreignKey['columns'][0]] = $foreignKey['foreign_table'] . '.' . $foreignKey['foreign_columns'][0];
        }

        return $map;
    }

    /**
     * @param list<array{name: string, columns: list<string>, foreign_table: string, foreign_columns: list<string>, on_update: string, on_delete: string}> $foreignKeys
     * @return list<DcForeignKey>
     */
    private function foreignKeys(array $foreignKeys): array
    {
        return array_map(fn(array $foreignKey): array => [
            'name' => $foreignKey['name'],
            'columns' => $foreignKey['columns'],
            'references' => $foreignKey['foreign_table'] . '.' . $foreignKey['foreign_columns'][0],
            'onDelete' => strtoupper($foreignKey['on_delete']),
            'onUpdate' => strtoupper($foreignKey['on_update']),
        ], $foreignKeys);
    }

    private function rowCount(string $schema, string $table, string $type): int
    {
        $estimate = (int)($this->connection->db()->selectOne('SELECT reltuples::bigint AS estimate FROM pg_class WHERE oid = to_regclass(?)',
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
            ->map(fn(object $row): array => $this->normalizeRow((array)$row))
            ->all();

        return $this->redactor->maskRows($rows);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        return array_map(fn(mixed $value): mixed => is_resource($value) ? '[binary]' : $value, $row);
    }

    /**
     * The `public` schema stays unqualified, so its queries are byte-for-byte
     * what they were before multi-schema support.
     */
    private function qualify(string $schema, string $table): string
    {
        return $schema === 'public' ? $table : "{$schema}.{$table}";
    }

    private function schema(): Builder
    {
        return $this->connection->db()->getSchemaBuilder();
    }
}
