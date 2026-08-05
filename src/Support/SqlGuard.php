<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Phattarachai\DbConsole\Exceptions\SqlGuardException;

/**
 * The statement guard: one statement per run, a first keyword the connection's
 * mode allows, and no reference to a hidden table.
 *
 * Mirrors the client-side `classifySql` (`resources/js/components/db-console/sql-lib.js`),
 * which is UX only — this is the enforcement. DDL is blocked in every mode.
 */
final readonly class SqlGuard
{
    /** Statements that only read; allowed on any connection. */
    public const array READ_KEYWORDS = ['select', 'with', 'explain', 'show', 'table', 'values'];

    /** Statements that write rows; allowed only on a `write` connection. */
    public const array DML_KEYWORDS = ['insert', 'update', 'delete', 'merge'];

    /** DDL, session state and transaction control — never allowed, in any mode. */
    public const array BLOCKED_KEYWORDS = [
        'drop',
        'alter',
        'create',
        'truncate',
        'grant',
        'revoke',
        'copy',
        'call',
        'do',
        'vacuum',
        'reindex',
        'comment',
        'lock',
        'set',
        'begin',
        'commit',
        'rollback',
        'refresh',
    ];

    public function __construct(private Connection $connection) {}

    /**
     * @return 'read'|'write'
     */
    public function classify(string $sql): string
    {
        $stripped = rtrim($this->stripStringsAndComments($sql), "; \t\n\r\0");

        if ($stripped === '') {
            throw new SqlGuardException(__('db-console::guard.empty'));
        }

        if (str_contains($stripped, ';')) {
            throw new SqlGuardException(__('db-console::guard.single_statement'));
        }

        if (! preg_match('/^\s*([a-zA-Z_]+)/', $stripped, $matches)) {
            throw new SqlGuardException(__('db-console::guard.must_start'));
        }

        $kind = $this->kindOf(strtolower($matches[1]), strtoupper($matches[1]));

        $this->assertNoHiddenTable($sql);

        return $kind;
    }

    /**
     * @return 'read'|'write'
     */
    private function kindOf(string $keyword, string $upper): string
    {
        if (in_array($keyword, self::BLOCKED_KEYWORDS, strict: true)) {
            throw new SqlGuardException(__('db-console::guard.blocked', ['keyword' => $upper]));
        }

        if (in_array($keyword, self::DML_KEYWORDS, strict: true)) {
            if (! $this->connection->isWritable()) {
                throw new SqlGuardException(__('db-console::guard.read_only', ['keyword' => $upper]));
            }

            return 'write';
        }

        if (in_array($keyword, self::READ_KEYWORDS, strict: true)) {
            return 'read';
        }

        throw new SqlGuardException(__('db-console::guard.unsupported', ['keyword' => $upper]));
    }

    /**
     * Every bare identifier is checked against the hidden-table globs — no SQL
     * parsing, so an alias or column that happens to match is refused too. A
     * false positive is the safe direction here.
     */
    private function assertNoHiddenTable(string $sql): void
    {
        if (! preg_match_all('/[a-zA-Z_][a-zA-Z0-9_$]*/', $this->identifiersOf($sql), $matches)) {
            return;
        }

        $redactor = $this->connection->redactor();

        foreach (array_unique($matches[0]) as $identifier) {
            if ($redactor->isHiddenTable($identifier)) {
                $redactor->assertVisible($identifier);
            }
        }
    }

    /**
     * The statement with comments and string literals removed but quoted
     * identifiers unwrapped, so `from "sessions"` is scanned like `from sessions`
     * while a table name mentioned inside a string is not.
     */
    private function identifiersOf(string $sql): string
    {
        $stripped = preg_replace([
            '/--[^\n]*/',
            '#/\*.*?\*/#s',
            "/'(?:[^']|'')*'/s",
        ], ' ', $sql) ?? $sql;

        return str_replace('"', ' ', $stripped);
    }

    /**
     * Blank out string literals, quoted identifiers and comments so their
     * contents can't smuggle a `;` or a blocked keyword past the guard.
     */
    private function stripStringsAndComments(string $sql): string
    {
        return preg_replace([
            '/--[^\n]*/',
            '#/\*.*?\*/#s',
            "/'(?:[^']|'')*'/s",
            '/"(?:[^"]|"")*"/s',
        ], ' ', $sql) ?? $sql;
    }
}
