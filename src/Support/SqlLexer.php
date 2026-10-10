<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

/**
 * Splits a statement into what the server will execute and what it will not —
 * string literals, comments and quoted identifiers — following the quoting
 * rules of one SQL dialect.
 *
 * The guard can only reason about the code it can see, so the lexer has to
 * agree with the engine about where a literal ends. A regex that is right for
 * one dialect is wrong for another: Postgres has `$tag$` and `E'..'` strings and
 * nested comments, MySQL has `#` comments, backslash escapes, backtick
 * identifiers and `/*! .. *\/` comments it *executes*. Getting any of these
 * wrong lets a `;` or a keyword hide inside what the guard took for a string.
 *
 * Whether a plain `'..'` string honours backslash escapes is a session setting
 * on both engines (`standard_conforming_strings`, `NO_BACKSLASH_ESCAPES`), so
 * the caller lexes both ways and requires both readings to pass.
 */
final readonly class SqlLexer
{
    public const string POSTGRES = 'pgsql';

    public const string MYSQL = 'mysql';

    public function __construct(private string $dialect) {}

    /**
     * The statement with every literal and comment replaced by a space and every
     * quoted identifier by a placeholder word — what the keyword checks read.
     */
    public function code(string $sql, bool $backslashEscapes): string
    {
        return $this->render($sql, $backslashEscapes, unwrapIdentifiers: false);
    }

    /**
     * The same, but with quoted identifiers unwrapped to their bare name, so the
     * hidden-table scan sees `"sessions"` and `` `sessions` `` as `sessions`.
     */
    public function identifiers(string $sql, bool $backslashEscapes): string
    {
        return $this->render($sql, $backslashEscapes, unwrapIdentifiers: true);
    }

    private function render(string $sql, bool $backslashEscapes, bool $unwrapIdentifiers): string
    {
        $out = '';

        foreach ($this->tokens($sql, $backslashEscapes) as [$type, $text]) {
            $out .= match ($type) {
                'code' => $text,
                'ident' => $unwrapIdentifiers ? ' '.$text.' ' : ' quoted_identifier ',
                default => ' ',
            };
        }

        return $out;
    }

    /**
     * @return list<array{0: 'code'|'string'|'comment'|'ident', 1: string}>
     */
    private function tokens(string $sql, bool $backslashEscapes): array
    {
        $tokens = [];
        $length = strlen($sql);
        $insideExecutableComment = false;

        for ($i = 0; $i < $length;) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';

            if ($this->dialect === self::MYSQL && $insideExecutableComment && $char === '*' && $next === '/') {
                $insideExecutableComment = false;
                $tokens[] = ['code', ' '];
                $i += 2;

                continue;
            }

            if ($this->startsLineComment($sql, $i)) {
                $end = strpos($sql, "\n", $i);
                $i = $end === false ? $length : $end;
                $tokens[] = ['comment', ''];

                continue;
            }

            if ($char === '/' && $next === '*') {
                if ($this->dialect === self::MYSQL && preg_match('/\G\/\*M?!\d*/', $sql, $match, 0, $i)) {
                    // MySQL and MariaDB *run* the body of /*! .. */ — it is code.
                    $insideExecutableComment = true;
                    $tokens[] = ['code', ' '];
                    $i += strlen($match[0]);

                    continue;
                }

                $i = $this->blockCommentEnd($sql, $i);
                $tokens[] = ['comment', ''];

                continue;
            }

            if ($char === "'" || ($char === '"' && $this->dialect === self::MYSQL)) {
                $escapes = $this->dialect === self::MYSQL ? $backslashEscapes : ($this->isEscapeString($sql, $i) || $backslashEscapes);
                $i = $this->quotedEnd($sql, $i, $char, $escapes);
                $tokens[] = ['string', ''];

                continue;
            }

            if (($char === '"' && $this->dialect === self::POSTGRES) || ($char === '`' && $this->dialect === self::MYSQL)) {
                $end = $this->quotedEnd($sql, $i, $char, escapes: false);
                $tokens[] = ['ident', str_replace($char.$char, $char, substr($sql, $i + 1, max(0, $end - $i - 2)))];
                $i = $end;

                continue;
            }

            if ($char === '$' && $this->dialect === self::POSTGRES && ! $this->followsWordCharacter($sql, $i)
                && preg_match('/\G\$([A-Za-z_][A-Za-z0-9_]*)?\$/', $sql, $match, 0, $i)) {
                $close = strpos($sql, $match[0], $i + strlen($match[0]));
                $i = $close === false ? $length : $close + strlen($match[0]);
                $tokens[] = ['string', ''];

                continue;
            }

            $tokens[] = ['code', $char];
            $i++;
        }

        return $tokens;
    }

    /**
     * `--` starts a comment in Postgres; MySQL needs whitespace (or the end)
     * after it, so `1--1` is arithmetic there. `#` is a comment in MySQL only.
     */
    private function startsLineComment(string $sql, int $i): bool
    {
        if ($this->dialect === self::MYSQL && $sql[$i] === '#') {
            return true;
        }

        if ($sql[$i] !== '-' || ($sql[$i + 1] ?? '') !== '-') {
            return false;
        }

        if ($this->dialect === self::POSTGRES) {
            return true;
        }

        $after = $sql[$i + 2] ?? '';

        return $after === '' || ctype_space($after) || ctype_cntrl($after);
    }

    /**
     * Postgres nests block comments; MySQL ends at the first `*\/`. An
     * unterminated comment runs to the end of the input.
     */
    private function blockCommentEnd(string $sql, int $start): int
    {
        $length = strlen($sql);
        $depth = 0;

        for ($i = $start; $i < $length; $i++) {
            if ($sql[$i] === '/' && ($sql[$i + 1] ?? '') === '*') {
                $depth = $this->dialect === self::POSTGRES ? $depth + 1 : 1;
                $i++;
            } elseif ($sql[$i] === '*' && ($sql[$i + 1] ?? '') === '/') {
                $depth--;
                $i++;

                if ($depth === 0) {
                    return $i + 1;
                }
            }
        }

        return $length;
    }

    /**
     * The offset just past the closing quote. A doubled quote is an escaped
     * quote; with `$escapes`, so is a backslash before any character. An
     * unterminated literal runs to the end of the input.
     */
    private function quotedEnd(string $sql, int $start, string $quote, bool $escapes): int
    {
        $length = strlen($sql);

        for ($i = $start + 1; $i < $length; $i++) {
            if ($escapes && $sql[$i] === '\\') {
                $i++;

                continue;
            }

            if ($sql[$i] === $quote) {
                if (($sql[$i + 1] ?? '') === $quote) {
                    $i++;

                    continue;
                }

                return $i + 1;
            }
        }

        return $length;
    }

    /** Postgres `E'..'` — a lone E (any case) right before the quote. */
    private function isEscapeString(string $sql, int $quote): bool
    {
        return $quote > 0
            && in_array($sql[$quote - 1], ['E', 'e'], strict: true)
            && ! $this->followsWordCharacter($sql, $quote - 1);
    }

    private function followsWordCharacter(string $sql, int $i): bool
    {
        return $i > 0 && (ctype_alnum($sql[$i - 1]) || $sql[$i - 1] === '_' || $sql[$i - 1] === '$');
    }
}
