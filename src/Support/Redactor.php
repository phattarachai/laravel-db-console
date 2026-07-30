<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Support\Str;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;

/**
 * The safety layer for one resolved connection: hidden tables never leave the
 * server, and masked column values are replaced before they reach the browser.
 * Both lists are glob patterns matched case-insensitively.
 */
final readonly class Redactor
{
    public const string MASK = '***';

    public function __construct(private Connection $connection)
    {
    }

    public function isHiddenTable(string $table): bool
    {
        return $this->matches($this->connection->hiddenTables, $table);
    }

    /**
     * Refuse any access to a hidden table.
     */
    public function assertVisible(string $table): void
    {
        if ($this->isHiddenTable($table)) {
            throw new SqlGuardException(__('db-console::guard.hidden_table', ['table' => $table]));
        }
    }

    public function isMaskedColumn(string $column): bool
    {
        return $this->matches($this->connection->maskedColumns, $column);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    public function maskRows(array $rows): array
    {
        return array_map($this->maskRow(...), array_values($rows));
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function maskRow(array $row): array
    {
        $masked = [];

        foreach ($row as $column => $value) {
            $masked[$column] = ($value !== null && $this->isMaskedColumn((string)$column)) ? self::MASK : $value;
        }

        return $masked;
    }

    /**
     * @param list<string> $names
     * @return list<string>
     */
    public function visibleTables(array $names): array
    {
        return array_values(array_filter($names, fn(string $name): bool => !$this->isHiddenTable($name)));
    }

    /**
     * @param list<string> $patterns
     */
    private function matches(array $patterns, string $value): bool
    {
        if ($patterns === []) {
            return false;
        }

        return Str::is(array_map(strtolower(...), $patterns), strtolower($value));
    }
}
