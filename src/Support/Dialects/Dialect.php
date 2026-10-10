<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support\Dialects;

use Closure;
use Illuminate\Database\Connection as DatabaseConnection;
use Illuminate\Database\MySqlConnection;
use PDO;
use PDOStatement;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Throwable;

/**
 * Everything the console does differently per database engine: how a read is
 * made read-only and bounded in time, how a write is bounded, how row counts
 * are estimated, how an object's kind is read, how EXPLAIN is rendered and how
 * identifiers are quoted.
 *
 * The rest of the package reads through Laravel's schema and query builders,
 * which already speak both dialects, so this class holds only what they don't.
 */
abstract class Dialect
{
    public static function for(DatabaseConnection $db): self
    {
        return match ($db->getDriverName()) {
            'pgsql' => new PostgresDialect,
            'mysql', 'mariadb' => new MySqlDialect(maria: $db instanceof MySqlConnection && $db->isMaria()),
            default => throw UnsupportedDriverException::for($db->getName() ?? 'default', $db->getDriverName()),
        };
    }

    /**
     * `pgsql`, `mysql` or `mariadb` — handed to the browser so the client guard
     * lexes with the same rules.
     */
    abstract public function name(): string;

    /** The toolbar's engine label, e.g. `PostgreSQL 17.4` or `MySQL 8.4.9`. */
    abstract public function serverLabel(DatabaseConnection $db): string;

    /** The schema a bare table name resolves to — `public`, or the connection's database. */
    abstract public function defaultSchema(DatabaseConnection $db): string;

    /**
     * Run `$callback` inside a READ ONLY transaction with the statement timeout
     * applied, and always roll it back — the engine refuses a write the guard
     * missed, and nothing the callback did survives it.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    abstract public function read(DatabaseConnection $db, int $timeout, Closure $callback): mixed;

    /**
     * Run `$callback` in a transaction bounded by the timeout, committing only
     * when it returns.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    abstract public function write(DatabaseConnection $db, int $timeout, Closure $callback): mixed;

    /**
     * Every relation's planner row estimate for one schema, in one query.
     *
     * @return array<string, int>
     */
    abstract public function estimates(DatabaseConnection $db, string $schema): array;

    /** The estimate for one table, or 0 when the engine has none. */
    abstract public function rowEstimate(DatabaseConnection $db, string $schema, string $table): int;

    /**
     * `table`, `view`, or null when no such object exists — read from the
     * catalog, never trusted from the request.
     */
    abstract public function kindOf(DatabaseConnection $db, string $schema, string $name): ?string;

    /**
     * The plan for `$sql` as display lines. Called inside {@see read()}, and
     * never with ANALYZE, so the statement itself is not executed.
     *
     * @return list<string>
     */
    abstract public function explain(DatabaseConnection $db, string $sql): array;

    /**
     * `<column> ILIKE` on Postgres (cast to text, so a uuid column matches too);
     * `<column> LIKE` on MySQL, where case follows the column's collation.
     */
    abstract public function caseInsensitiveMatch(string $wrappedColumn): string;

    /** Whether `INSERT .. RETURNING *` hands the stored row back. */
    abstract public function supportsReturning(): bool;

    /** Friendlier names for the native column types PDO reports for a result set. */
    abstract public function displayType(string $native): string;

    abstract public function quoteIdentifier(string $identifier): string;

    public function quoteQualified(string $schema, string $table): string
    {
        return $this->quoteIdentifier($schema).'.'.$this->quoteIdentifier($table);
    }

    /**
     * Prepare `$sql` as one server-side statement. A server-side prepare holds
     * exactly one statement on both engines, so even a guard bug can't turn this
     * into a batch — unlike `PDO::exec()` or an emulated prepare, which pass a
     * `;`-separated string straight through.
     */
    public function prepare(DatabaseConnection $db, string $sql): PDOStatement
    {
        $statement = $db->getPdo()->prepare($sql, $this->singleStatementOptions());

        if (! $statement instanceof PDOStatement) {
            throw new SqlGuardException((string) __('db-console::guard.failed'));
        }

        return $statement;
    }

    /**
     * @return array<int, mixed>
     */
    abstract protected function singleStatementOptions(): array;

    protected function rollBackQuietly(DatabaseConnection $db): void
    {
        try {
            $db->rollBack();
        } catch (Throwable) {
            // The transaction may already be aborted (e.g. after a statement error).
        }
    }

    protected function serverVersion(DatabaseConnection $db): string
    {
        return (string) $db->getPdo()->getAttribute(PDO::ATTR_SERVER_VERSION);
    }
}
