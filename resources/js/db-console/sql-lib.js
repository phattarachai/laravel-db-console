/**
 * Self-contained SQL helpers for the Database Console SQL mode — no external deps
 * so the whole module stays drop-in portable. One tokenizer powers both the
 * syntax-highlight overlay and the light formatter; `classifySql` is the
 * client-side, mode-aware statement guard (a mirror of the server's `SqlGuard`
 * and `SqlLexer` — see `.ai/documents/security-model.md`).
 */

import { translate } from './strings'

const KEYWORDS = new Set([
  'select',
  'insert',
  'into',
  'update',
  'set',
  'delete',
  'merge',
  'replace',
  'returning',
  'create',
  'alter',
  'drop',
  'truncate',
  'table',
  'from',
  'where',
  'group',
  'by',
  'order',
  'having',
  'limit',
  'offset',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'on',
  'using',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'like',
  'ilike',
  'between',
  'as',
  'with',
  'union',
  'all',
  'distinct',
  'case',
  'when',
  'then',
  'else',
  'end',
  'asc',
  'desc',
  'explain',
  'analyze',
  'show',
  'values',
  'exists',
  'any',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'coalesce',
  'nullif',
  'cast',
  'over',
  'partition',
  'true',
  'false',
])

/** Clause keywords that start a new line when formatting. */
const CLAUSE_STARTERS = new Set([
  'select',
  'from',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'union',
])

/** Statements that only read; allowed on any connection (first keyword). */
const READ_KEYWORDS = new Set([
  'select',
  'with',
  'explain',
  'show',
  'table',
  'values',
  'describe',
  'desc',
])

/** Statements that write rows; allowed only when `mode` is `write`. */
const DML_KEYWORDS = new Set(['insert', 'update', 'delete', 'merge', 'replace'])

/**
 * DDL, session state, transaction control, server administration and dynamic
 * SQL — never allowed, in any mode.
 */
const BLOCKED_KEYWORDS = new Set([
  'drop',
  'alter',
  'create',
  'truncate',
  'rename',
  'comment',
  'grant',
  'revoke',
  'copy',
  'load',
  'import',
  'handler',
  'call',
  'do',
  'prepare',
  'execute',
  'deallocate',
  'vacuum',
  'reindex',
  'refresh',
  'analyze',
  'optimize',
  'repair',
  'check',
  'checksum',
  'lock',
  'unlock',
  'set',
  'reset',
  'use',
  'begin',
  'start',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'xa',
  'flush',
  'kill',
  'install',
  'uninstall',
  'shutdown',
  'restart',
  'purge',
  'change',
  'stop',
  'cache',
  'binlog',
])

/** Functions that act outside the transaction (`dblink*` is a prefix). */
const BLOCKED_FUNCTIONS = [
  'load_file',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'dblink*',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'set_config',
]

/**
 * Split SQL into typed tokens: comment | string | number | keyword | ident |
 * punct | ws. Strings/comments are kept whole so the formatter never mangles
 * their contents.
 *
 * @returns {Array<{type: string, value: string}>}
 */
export function tokenizeSql(sql) {
  const tokens = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]

    if (c === '-' && sql[i + 1] === '-') {
      let j = i + 2
      while (j < n && sql[j] !== '\n') {
        j++
      }
      tokens.push({ type: 'comment', value: sql.slice(i, j) })
      i = j
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) {
        j++
      }
      j = Math.min(n, j + 2)
      tokens.push({ type: 'comment', value: sql.slice(i, j) })
      i = j
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === c && sql[j + 1] === c) {
          j += 2
          continue
        }
        if (sql[j] === c) {
          j++
          break
        }
        j++
      }
      tokens.push({ type: c === "'" ? 'string' : 'ident', value: sql.slice(i, j) })
      i = j
      continue
    }
    if (/\s/.test(c)) {
      let j = i + 1
      while (j < n && /\s/.test(sql[j])) {
        j++
      }
      tokens.push({ type: 'ws', value: sql.slice(i, j) })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      let j = i + 1
      while (j < n && /[0-9._]/.test(sql[j])) {
        j++
      }
      tokens.push({ type: 'number', value: sql.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) {
        j++
      }
      const word = sql.slice(i, j)
      tokens.push({ type: KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'ident', value: word })
      i = j
      continue
    }
    tokens.push({ type: 'punct', value: c })
    i++
  }
  return tokens
}

/**
 * Render `sql` with every literal and comment blanked, following one dialect's
 * quoting rules — a mirror of the server's `SqlLexer`. Postgres has `$tag$` and
 * `E'..'` strings and nested comments; MySQL has `#` comments, backslash
 * escapes, backtick identifiers and `/*! .. *\/` comments it executes.
 *
 * Quoted identifiers become a placeholder word, or their bare name when
 * `unwrap` is set (for the function scan).
 */
function lexSql(sql, dialect, backslashEscapes, unwrap) {
  const mysql = dialect !== 'pgsql'
  const n = sql.length
  let out = ''
  let inExecutable = false
  let i = 0

  const wordBefore = (at) => at > 0 && /[A-Za-z0-9_$]/.test(sql[at - 1])

  const quotedEnd = (start, quote, escapes) => {
    for (let j = start + 1; j < n; j++) {
      if (escapes && sql[j] === '\\') {
        j++
        continue
      }
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) {
          j++
          continue
        }
        return j + 1
      }
    }
    return n
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1] ?? ''

    if (mysql && inExecutable && c === '*' && next === '/') {
      inExecutable = false
      out += ' '
      i += 2
      continue
    }

    const after = sql[i + 2] ?? ''
    const lineComment =
      (mysql && c === '#') ||
      (c === '-' && next === '-' && (!mysql || after === '' || /[\s\x00-\x1f]/.test(after)))
    if (lineComment) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end
      out += ' '
      continue
    }

    if (c === '/' && next === '*') {
      const executable = mysql ? /^\/\*M?!\d*/.exec(sql.slice(i)) : null
      if (executable) {
        inExecutable = true
        out += ' '
        i += executable[0].length
        continue
      }
      let depth = 0
      let j = i
      for (; j < n; j++) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth = mysql ? 1 : depth + 1
          j++
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--
          j++
          if (depth === 0) {
            j++
            break
          }
        }
      }
      i = Math.min(j, n)
      out += ' '
      continue
    }

    if (c === "'" || (c === '"' && mysql)) {
      const escapeString = !mysql && i > 0 && /[Ee]/.test(sql[i - 1]) && !wordBefore(i - 1)
      i = quotedEnd(i, c, mysql ? backslashEscapes : escapeString || backslashEscapes)
      out += ' '
      continue
    }

    if ((c === '"' && !mysql) || (c === '`' && mysql)) {
      const end = quotedEnd(i, c, false)
      out += unwrap
        ? ` ${sql.slice(i + 1, Math.max(i + 1, end - 1)).replaceAll(c + c, c)} `
        : ' quoted_identifier '
      i = end
      continue
    }

    if (c === '$' && !mysql && !wordBefore(i)) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        i = close === -1 ? n : close + tag[0].length
        out += ' '
        continue
      }
    }

    out += c
    i++
  }

  return out
}

/**
 * Classify the submitted SQL for the statement guard.
 *
 * The client-side mirror of the server's `SqlGuard` (`src/Support/SqlGuard.php`):
 * same lexer rules, keyword sets, order of checks and message keys — the server
 * is still the enforcement, this only keeps the UI honest. `mode` is the active
 * connection's mode, so DML is a valid statement on a `write` connection and
 * rejected on a `read` one; `dialect` picks the quoting rules. Like the server,
 * it reads the statement with and without backslash escapes and needs both to pass.
 *
 * The verdict is returned as a **string key + replacements** (`strings.js`), not
 * as ready-made copy — this module isn't a component and can't reach the strings
 * context, so the caller renders it with `t(messageKey, replacements)`. `reason`
 * stays on the shape for older callers and holds the English default.
 *
 * @param {string} sql
 * @param {'read'|'write'} [mode] the active connection's mode
 * @param {'pgsql'|'mysql'|'mariadb'} [dialect] the active connection's engine
 * @returns {{ok: boolean, kind: 'read'|'write'|null, keyword: string,
 *   messageKey: string, replacements: Record<string, string>, reason: string}}
 */
export function classifySql(sql, mode = 'read', dialect = 'pgsql') {
  let result = null

  for (const backslashEscapes of [false, true]) {
    result = classifyCode(lexSql(sql, dialect, backslashEscapes, false), mode)
    if (!result.ok) {
      return result
    }
    const blocked = blockedFunction(lexSql(sql, dialect, backslashEscapes, true))
    if (blocked) {
      return verdict(false, null, result.keyword, 'guard.blocked_function', { function: blocked })
    }
  }

  return result
}

function classifyCode(code, mode) {
  const stripped = code.replace(/[;\s\0]+$/, '')

  if (stripped.trim() === '') {
    return verdict(false, null, '', 'guard.empty')
  }

  // Reject multiple statements: any ';' left once the trailing one is trimmed.
  if (stripped.includes(';')) {
    return verdict(false, null, ';', 'guard.single_statement')
  }

  const leading = /^\s*([a-zA-Z_]+)/.exec(stripped)
  if (leading === null) {
    return verdict(false, null, '', 'guard.must_start')
  }

  const keyword = leading[1].toUpperCase()
  const lower = leading[1].toLowerCase()

  if (BLOCKED_KEYWORDS.has(lower)) {
    return verdict(false, null, keyword, 'guard.blocked', { keyword })
  }
  if (DML_KEYWORDS.has(lower)) {
    return mode === 'write'
      ? verdict(true, 'write', keyword, 'guard.write', { keyword })
      : verdict(false, null, keyword, 'guard.read_only', { keyword })
  }
  if (READ_KEYWORDS.has(lower)) {
    return /\binto\b/i.test(stripped)
      ? verdict(false, null, keyword, 'guard.select_into', { keyword })
      : verdict(true, 'read', keyword, 'guard.read')
  }
  return verdict(false, null, keyword, 'guard.unsupported', { keyword })
}

/** The first called function on the blocked list, lower-cased, or null. */
function blockedFunction(code) {
  for (const match of code.matchAll(/([a-zA-Z_][a-zA-Z0-9_$]*)\s*\(/g)) {
    const name = match[1].toLowerCase()
    const hit = BLOCKED_FUNCTIONS.some((pattern) =>
      pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
    )
    if (hit) {
      return name
    }
  }
  return null
}

/** Build a `classifySql` verdict: the message key plus its English default. */
function verdict(ok, kind, keyword, messageKey, replacements = {}) {
  return {
    ok,
    kind,
    keyword,
    messageKey,
    replacements,
    reason: translate(null, messageKey, replacements),
  }
}

/**
 * Light, string-safe formatter: uppercases keywords and breaks before major
 * clauses + JOINs. Intentionally simple (not a full SQL pretty-printer) — good
 * enough for a demo console and never touches string/comment contents.
 */
export function formatSql(sql) {
  const tokens = tokenizeSql(sql)
  let out = ''
  let atLineStart = true
  tokens.forEach((tok, idx) => {
    if (tok.type === 'ws') {
      return
    }
    const lower = tok.value.toLowerCase()
    const prev = nextMeaningful(tokens, idx, -1)
    const isJoinStart =
      tok.type === 'keyword' &&
      (lower === 'join' ||
        ((lower === 'left' ||
          lower === 'right' ||
          lower === 'inner' ||
          lower === 'full' ||
          lower === 'cross') &&
          nextMeaningful(tokens, idx, 1)?.value.toLowerCase() !== 'outer'))
    const breakBefore =
      !atLineStart &&
      tok.type === 'keyword' &&
      (CLAUSE_STARTERS.has(lower) || isJoinStart) &&
      prev?.value.toLowerCase() !== 'group' && // don't break "GROUP BY" between the words
      prev?.value.toLowerCase() !== 'order' &&
      prev?.value.toLowerCase() !== 'union'

    if (breakBefore) {
      out = `${out.replace(/ $/, '')}\n`
      atLineStart = true
    }

    if (!atLineStart && needsSpaceBefore(tok, prev)) {
      out += ' '
    }
    out += tok.type === 'keyword' ? tok.value.toUpperCase() : tok.value
    atLineStart = false
  })
  return out.trim()
}

function nextMeaningful(tokens, from, step) {
  let i = from + step
  while (i >= 0 && i < tokens.length) {
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'comment') {
      return tokens[i]
    }
    i += step
  }
  return null
}

function needsSpaceBefore(tok, prev) {
  if (!prev) {
    return false
  }
  if (tok.value === ',' || tok.value === ';' || tok.value === ')' || tok.value === '.') {
    return false
  }
  if (prev.value === '(' || prev.value === '.') {
    return false
  }
  return true
}
