/**
 * Self-contained SQL helpers for the Database Console SQL mode — no external deps
 * so the whole module stays drop-in portable. One tokenizer powers both the
 * syntax-highlight overlay and the light formatter; `classifySql` is the
 * client-side, mode-aware statement guard (an exact mirror of the server's
 * `SqlGuard` — see `.ai/documents/admin/db-console.md`).
 */

import { translate } from './strings'

const KEYWORDS = new Set([
  'select',
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
const READ_KEYWORDS = new Set(['select', 'with', 'explain', 'show', 'table', 'values'])

/** Statements that write rows; allowed only when `mode` is `write`. */
const DML_KEYWORDS = new Set(['insert', 'update', 'delete', 'merge'])

/** DDL, session state and transaction control — never allowed, in any mode. */
const BLOCKED_KEYWORDS = new Set([
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
])

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
 * Blank out comments, string literals and quoted identifiers so their contents
 * can't smuggle a `;` or a blocked keyword past the guard. Mirrors
 * `SqlGuard::stripStringsAndComments()` regex for regex.
 */
function stripStringsAndComments(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/"(?:[^"]|"")*"/g, ' ')
}

/**
 * Classify the submitted SQL for the statement guard.
 *
 * The exact client-side mirror of the server's `SqlGuard` (`src/Support/SqlGuard.php`):
 * same keyword sets, same order of checks, same message keys — the server is still
 * the enforcement, this only keeps the UI honest. `mode` is the active connection's
 * mode, so DML is a valid statement on a `write` connection and rejected on a `read`
 * one.
 *
 * The verdict is returned as a **string key + replacements** (`strings.js`), not
 * as ready-made copy — this module isn't a component and can't reach the strings
 * context, so the caller renders it with `t(messageKey, replacements)`. `reason`
 * stays on the shape for older callers and holds the English default.
 *
 * @param {string} sql
 * @param {'read'|'write'} [mode] the active connection's mode
 * @returns {{ok: boolean, kind: 'read'|'write'|null, keyword: string,
 *   messageKey: string, replacements: Record<string, string>, reason: string}}
 */
export function classifySql(sql, mode = 'read') {
  const stripped = stripStringsAndComments(sql).replace(/[;\s\0]+$/, '')

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
    return verdict(true, 'read', keyword, 'guard.read')
  }
  return verdict(false, null, keyword, 'guard.unsupported', { keyword })
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
