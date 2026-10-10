<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Connection as DatabaseConnection;
use Illuminate\Support\Facades\DB;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\Dialects\Dialect;

/**
 * A browsable connection, resolved from config/db-console.php with the
 * `defaults` block folded in — so nothing downstream reads config() or
 * hardcodes a limit.
 *
 * `key` is the config key (which may be the literal "default"); `name` is the
 * real Laravel connection name it resolves to. `schemas` is the whitelist of
 * browsable schemas — on MySQL and MariaDB a schema is a database.
 */
final class Connection
{
    /** The Laravel drivers the console can browse. */
    public const array DRIVERS = ['pgsql', 'mysql', 'mariadb'];

    private ?Dialect $dialect = null;

    /**
     * @param  list<string>  $schemas
     * @param  list<string>  $hiddenTables
     * @param  list<string>  $maskedColumns
     */
    private function __construct(
        public string $key,
        public string $name,
        public string $driver,
        public ?string $label,
        public string $mode,
        public array $schemas,
        public int $maxRows,
        public int $timeout,
        public int $sampleRows,
        public bool $confirmWrites,
        public array $hiddenTables,
        public array $maskedColumns,
    ) {}

    /**
     * Resolve a configured connection by its config key. Null picks the first
     * one, which is what a single-connection install always wants.
     */
    public static function resolve(?string $key = null): self
    {
        $configured = self::configured();

        $key ??= array_key_first($configured) ?? 'default';

        if (! array_key_exists($key, $configured)) {
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
            fn (string $key, array $options): self => self::make($key, $options),
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

        if (! in_array($connection->getDriverName(), self::DRIVERS, strict: true)) {
            throw UnsupportedDriverException::for($this->name, $connection->getDriverName());
        }

        return $connection;
    }

    /**
     * The engine-specific half of every read, write and catalog query. Asking
     * for it connects, because MariaDB behind the `mysql` driver is only known
     * from the server version.
     */
    public function dialect(): Dialect
    {
        return $this->dialect ??= Dialect::for($this->db());
    }

    /**
     * Which quoting rules the guard lexes with — known from config alone, so
     * classifying a statement never needs a round trip.
     */
    public function lexerDialect(): string
    {
        return $this->driver === 'pgsql' ? SqlLexer::POSTGRES : SqlLexer::MYSQL;
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
     * `label` is the configured label, falling back to the database name, so the
     * toolbar pill shows what the app owner named the connection.
     *
     * @return array{key: string, name: string, label: string, database: string, driver: string, dialect: string, mode: string, confirmWrites: bool}
     */
    public function payload(): array
    {
        $connection = $this->db();
        $dialect = $this->dialect();

        return [
            'key' => $this->key,
            'name' => $this->name,
            'label' => $this->label ?? $connection->getDatabaseName(),
            'database' => $connection->getDatabaseName(),
            'driver' => $dialect->serverLabel($connection),
            'dialect' => $dialect->name(),
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

        return array_map(fn (?array $options): array => $options ?? [], $connections);
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private static function make(string $key, array $options): self
    {
        /** @var array<string, mixed> $defaults */
        $defaults = config('db-console.defaults', []);
        $options = [...$defaults, ...$options];

        $name = $key === 'default' ? (string) config('database.default') : $key;

        if (config("database.connections.{$name}") === null) {
            throw UnsupportedDriverException::unknown($name);
        }

        $driver = (string) config("database.connections.{$name}.driver");
        $label = $options['label'] ?? null;

        return new self(
            key: $key,
            name: $name,
            driver: $driver,
            label: is_string($label) && $label !== '' ? $label : null,
            mode: ($options['mode'] ?? 'read') === 'write' ? 'write' : 'read',
            schemas: self::schemas($driver, $name, $options['schemas'] ?? null),
            maxRows: (int) ($options['max_rows'] ?? 5000),
            timeout: (int) ($options['timeout'] ?? 5000),
            sampleRows: (int) ($options['sample_rows'] ?? 100),
            confirmWrites: (bool) ($options['confirm_writes'] ?? true),
            hiddenTables: array_values((array) config('db-console.hidden_tables', [])),
            maskedColumns: array_values((array) config('db-console.masked_columns', [])),
        );
    }

    /**
     * Unset means the driver's own default: `public` on Postgres, the
     * connection's database on MySQL and MariaDB. On those two a listed
     * `public` also means the connection's database, so a config file published
     * before MySQL support still works there.
     *
     * @return list<string>
     */
    private static function schemas(string $driver, string $name, mixed $configured): array
    {
        $database = (string) config("database.connections.{$name}.database");
        $default = $driver === 'pgsql' ? 'public' : $database;

        $schemas = array_values(array_filter(
            array_map(strval(...), (array) ($configured ?? [$default])),
            fn (string $schema): bool => $schema !== '',
        ));

        if ($driver !== 'pgsql') {
            $schemas = array_values(array_unique(array_map(
                fn (string $schema): string => $schema === 'public' ? $database : $schema,
                $schemas,
            )));
        }

        return $schemas === [] ? [$default] : $schemas;
    }
}
