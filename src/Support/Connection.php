<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Connection as DatabaseConnection;
use Illuminate\Support\Facades\DB;
use PDO;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;

/**
 * A browsable connection, resolved from config/db-console.php with the
 * `defaults` block folded in — so nothing downstream reads config() or
 * hardcodes a limit.
 *
 * `key` is the config key (which may be the literal "default"); `name` is the
 * real Laravel connection name it resolves to.
 */
final class Connection
{
    public const string DRIVER = 'pgsql';

    /**
     * @param list<string> $schemas
     * @param list<string> $hiddenTables
     * @param list<string> $maskedColumns
     */
    private function __construct(
        public string $key,
        public string $name,
        public string $label,
        public string $mode,
        public array $schemas,
        public int $maxRows,
        public int $timeout,
        public int $sampleRows,
        public bool $confirmWrites,
        public array $hiddenTables,
        public array $maskedColumns,
    ) {
    }

    /**
     * Resolve a configured connection by its config key. Null picks the first
     * one, which is what a single-connection install always wants.
     */
    public static function resolve(?string $key = null): self
    {
        $configured = self::configured();

        $key ??= array_key_first($configured) ?? 'default';

        if (!array_key_exists($key, $configured)) {
            throw UnsupportedDriverException::notConfigured($key);
        }

        return self::make($key, $configured[$key]);
    }

    /**
     * Every configured connection, in config order.
     *
     * @return list<self>
     */
    public static function all(): array
    {
        return array_values(array_map(
            fn(string $key, array $options): self => self::make($key, $options),
            array_keys(self::configured()),
            array_values(self::configured()),
        ));
    }

    /**
     * The underlying Laravel connection, driver-guarded.
     */
    public function db(): DatabaseConnection
    {
        $connection = DB::connection($this->name);

        if ($connection->getDriverName() !== self::DRIVER) {
            throw UnsupportedDriverException::for($this->name, $connection->getDriverName());
        }

        return $connection;
    }

    public function isWritable(): bool
    {
        return $this->mode === 'write';
    }

    public function redactor(): Redactor
    {
        return new Redactor($this);
    }

    /**
     * The toolbar payload — connection identity plus the driver version, read
     * only after the guard has passed.
     *
     * @return array{key: string, name: string, label: string, database: string, driver: string, mode: string, confirmWrites: bool}
     */
    public function payload(): array
    {
        $connection = $this->db();

        return [
            'key' => $this->key,
            'name' => $this->name,
            'label' => $this->label,
            'database' => $connection->getDatabaseName(),
            'driver' => 'PostgreSQL ' . $connection->getPdo()->getAttribute(PDO::ATTR_SERVER_VERSION),
            'mode' => $this->mode,
            'confirmWrites' => $this->confirmWrites,
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private static function configured(): array
    {
        /** @var array<string, array<string, mixed>|null> $connections */
        $connections = config('db-console.connections', ['default' => []]);

        return array_map(fn(?array $options): array => $options ?? [], $connections);
    }

    /**
     * @param array<string, mixed> $options
     */
    private static function make(string $key, array $options): self
    {
        /** @var array<string, mixed> $defaults */
        $defaults = config('db-console.defaults', []);
        $options = [...$defaults, ...$options];

        $name = $key === 'default' ? (string)config('database.default') : $key;

        if (config("database.connections.{$name}") === null) {
            throw UnsupportedDriverException::unknown($name);
        }

        return new self(
            key: $key,
            name: $name,
            label: (string)($options['label'] ?? $name),
            mode: ($options['mode'] ?? 'read') === 'write' ? 'write' : 'read',
            schemas: array_values((array)($options['schemas'] ?? ['public'])),
            maxRows: (int)($options['max_rows'] ?? 5000),
            timeout: (int)($options['timeout'] ?? 5000),
            sampleRows: (int)($options['sample_rows'] ?? 100),
            confirmWrites: (bool)($options['confirm_writes'] ?? true),
            hiddenTables: array_values((array)config('db-console.hidden_tables', [])),
            maskedColumns: array_values((array)config('db-console.masked_columns', [])),
        );
    }
}
