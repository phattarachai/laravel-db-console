/**
 * The filter builder's brains: given a column's Postgres type, which operators
 * make sense and what input each one needs. Kept UX-only and self-contained —
 * the server (see `RowReader`) independently whitelists the column and operator,
 * so nothing here is a security boundary.
 */

import { isNumericType } from './lib'

/** A column holds a date/time → offer range + comparison operators, a date input. */
export function isDateType(type) {
  return /date|time|timestamp/i.test(type ?? '')
}

/** A column holds a boolean → offer is-true / is-false. */
export function isBooleanType(type) {
  return /bool/i.test(type ?? '')
}

/** A column holds json/jsonb → only null checks make sense without a path syntax. */
export function isJsonType(type) {
  return /json/i.test(type ?? '')
}

/**
 * The `date`/`datetime-local`/`number`/`text` an <input> should be for this type.
 */
function baseInput(type) {
  if (isNumericType(type)) {
    return 'number'
  }
  if (isBooleanType(type)) {
    return 'none'
  }
  if (/timestamp|time/i.test(type ?? '')) {
    return 'datetime-local'
  }
  if (/date/i.test(type ?? '')) {
    return 'date'
  }
  return 'text'
}

/**
 * The operators offered for a column, most useful first. Values match the
 * server's operator set in `RowReader`.
 *
 * @returns {string[]}
 */
export function operatorsFor(type) {
  if (isBooleanType(type)) {
    return ['is_true', 'is_false', 'is_null', 'not_null']
  }
  if (isJsonType(type)) {
    return ['is_null', 'not_null']
  }
  if (isNumericType(type)) {
    return ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'in', 'is_null', 'not_null']
  }
  if (isDateType(type)) {
    return ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'is_null', 'not_null']
  }
  return ['contains', 'eq', 'ne', 'starts', 'ends', 'in', 'is_null', 'not_null']
}

/** Operators that need no value at all. */
const NULLARY = new Set(['is_null', 'not_null', 'is_true', 'is_false'])

/** Operators that take a two-ended range. */
const PAIR = new Set(['between'])

/** Operators that take a list of values. */
const LIST = new Set(['in', 'nin'])

/**
 * What the value editor for one condition should render.
 *
 * @returns {{ kind: 'none'|'single'|'pair'|'list', input: 'text'|'number'|'date'|'datetime-local'|'none' }}
 */
export function valueShapeFor(operator, type) {
  if (NULLARY.has(operator)) {
    return { kind: 'none', input: 'none' }
  }
  const input = baseInput(type) === 'none' ? 'text' : baseInput(type)
  if (PAIR.has(operator)) {
    return { kind: 'pair', input }
  }
  if (LIST.has(operator)) {
    return { kind: 'list', input }
  }
  return { kind: 'single', input }
}

/** The first operator to select when a column is picked. */
export function defaultOperatorFor(type) {
  return operatorsFor(type)[0]
}

/**
 * Coerce a raw input value to the type the column wants, so a numeric filter
 * sends a number rather than a string. Blank stays blank so the caller can skip
 * an unfinished condition.
 */
export function coerceValue(raw, input) {
  if (raw === '' || raw === null || raw === undefined) {
    return raw
  }
  if (input === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

/**
 * Whether a condition is complete enough to send. Nullary operators are always
 * ready; single/pair/list need their value(s) filled.
 */
export function isComplete(condition) {
  const { kind } = valueShapeFor(condition.operator, condition.type)
  if (kind === 'none') {
    return true
  }
  if (kind === 'pair') {
    return Array.isArray(condition.value) && condition.value[0] !== '' && condition.value[1] !== ''
  }
  if (kind === 'list') {
    return Array.isArray(condition.value) && condition.value.filter((v) => v !== '').length > 0
  }
  return condition.value !== '' && condition.value !== null && condition.value !== undefined
}

/**
 * Reduce the builder's working conditions to the wire payload `RowReader`
 * expects: `{column, operator, value}` with completed conditions only and the
 * `type` bookkeeping dropped.
 */
export function toPayload(conditions) {
  return conditions.filter(isComplete).map(({ column, operator, value, type }) => {
    const { kind, input } = valueShapeFor(operator, type)
    if (kind === 'none') {
      return { column, operator }
    }
    if (kind === 'pair') {
      return { column, operator, value: value.map((v) => coerceValue(v, input)) }
    }
    if (kind === 'list') {
      return {
        column,
        operator,
        value: value.filter((v) => v !== '').map((v) => coerceValue(v, input)),
      }
    }
    return { column, operator, value: coerceValue(value, input) }
  })
}
