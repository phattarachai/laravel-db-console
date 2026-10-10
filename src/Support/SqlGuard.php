<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Phattarachai\DbConsole\Exceptions\SqlGuardException;

/**
 * The statement guard: one statement per run, a first keyword the connection's
 * mode allows, no function that reaches outside the transaction, and no
 * reference to a hidden table.
 *
 * Mirrors the client-side `classifySql` (`resources/js/db-console/sql-lib.js`),
 * which is UX only — this is the enforcement. DDL is blocked in every mode.
 *
 * Literals and comments are removed by {@see SqlLexer} using the connection's
 * own quoting rules, read both with and without backslash escapes: the engine
 * reads it one of those two ways, so a statement has to pass under both.
 */
final readonly class SqlGuard
{
    /** Statements that only read; allowed on any connection. */
    public const array READ_KEYWORDS = ['select', 'with', 'explain', 'show', 'table', 'values', 'describe', 'desc'];

    /** Statements that write rows; allowed only on a `write` connection. */
    public const array DML_KEYWORDS = ['insert', 'update', 'delete', 'merge', 'replace'];

    /**
     * DDL, session state, transaction control, server administration and
     * dynamic SQL — never allowed, in any mode. Anything that is in no list is
     * refused as unsupported anyway; naming these gives a clearer message.
     */
    public const array BLOCKED_KEYWORDS = [
        'drop', 'alter', 'create', 'truncate', 'rename', 'comment',
        'grant', 'revoke',
        'copy', 'load', 'import', 'handler',
        'call', 'do', 'prepare', 'execute', 'deallocate',
        'vacuum', 'reindex', 'refresh', 'analyze', 'optimize', 'repair', 'check', 'checksum',
        'lock', 'unlock', 'set', 'reset', 'use',
        'begin', 'start', 'commit', 'rollback', 'savepoint', 'release', 'xa',
        'flush', 'kill', 'install', 'uninstall', 'shutdown', 'restart', 'purge', 'change', 'stop', 'cache', 'binlog',
    ];

    /**
     * Functions that act outside the transaction, so the engine's READ ONLY
     * cannot stop them: they read or write server files, open another
     * connection, signal other sessions, or change session settings (including
     * the statement timeout). Matched as a call, `name(`, in any mode.
     */
    public const array BLOCKED_FUNCTIONS = [
        'load_file',
        'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
        'lo_import', 'lo_export',
        'dblink*',
        'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile',
        'set_config',
    ];

    public function __construct(private Connection $connection) {}

    /**
     * @return 'read'|'write'
     */
    public function classify(string $sql): string
    {
        $lexer = new SqlLexer($this->connection->lexerDialect());
        $kind = null;

        foreach ([false, true] as $backslashEscapes) {
            $code = rtrim($lexer->code($sql, $backslashEscapes), "; \t\n\r\0");
            $kind = $this->classifyCode($code);

            $this->assertNoBlockedFunction($lexer->identifiers($sql, $backslashEscapes));
            $this->assertNoHiddenTable($lexer->identifiers($sql, $backslashEscapes));
        }

        return $kind;
    }

    /**
     * @return 'read'|'write'
     */
    private function classifyCode(string $code): string
    {
        if (trim($code) === '') {
            throw new SqlGuardException(__('db-console::guard.empty'));
        }

        if (str_contains($code, ';')) {
            throw new SqlGuardException(__('db-console::guard.single_statement'));
        }

        if (! preg_match('/^\s*([a-zA-Z_]+)/', $code, $matches)) {
            throw new SqlGuardException(__('db-console::guard.must_start'));
        }

        $kind = $this->kindOf(strtolower($matches[1]), strtoupper($matches[1]));

        // A read that writes somewhere else: a table (Postgres SELECT INTO), a
        // server file (MySQL INTO OUTFILE / DUMPFILE) or a session variable.
        if ($kind === 'read' && preg_match('/\binto\b/i', $code)) {
            throw new SqlGuardException(__('db-console::guard.select_into', ['keyword' => strtoupper($matches[1])]));
        }

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

    private function assertNoBlockedFunction(string $identifiers): void
    {
        if (! preg_match_all('/([a-zA-Z_][a-zA-Z0-9_$]*)\s*\(/', $identifiers, $matches)) {
            return;
        }

        foreach (array_unique($matches[1]) as $function) {
            foreach (self::BLOCKED_FUNCTIONS as $pattern) {
                if (fnmatch($pattern, strtolower($function))) {
                    throw new SqlGuardException(__('db-console::guard.blocked_function', ['function' => strtolower($function)]));
                }
            }
        }
    }

    /**
     * Every bare identifier is checked against the hidden-table globs — no SQL
     * parsing, so an alias or column that happens to match is refused too. A
     * false positive is the safe direction here.
     */
    private function assertNoHiddenTable(string $identifiers): void
    {
        if (! preg_match_all('/[a-zA-Z_][a-zA-Z0-9_$]*/', $identifiers, $matches)) {
            return;
        }

        $redactor = $this->connection->redactor();

        foreach (array_unique($matches[0]) as $identifier) {
            if ($redactor->isHiddenTable($identifier)) {
                $redactor->assertVisible($identifier);
            }
        }
    }
}
