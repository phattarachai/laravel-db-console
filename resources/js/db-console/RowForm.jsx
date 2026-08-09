import { useMemo, useState } from 'react'

import { AlertIcon, KeyIcon, LockIcon } from './icons'
import { cx, isNumericType } from './lib'
import { useStrings } from './strings'

/** What the server sends instead of a masked column's value (`Redactor::MASK`). */
const MASK = '***'

/**
 * Single-row editor for the grid — one field per column, typed from the column's
 * `type`, with a null toggle per nullable column.
 *
 * Three modes: `create` (blank fields; a blank optional field is **omitted** from
 * the payload so the column default applies), `update` (seeded from the row, with
 * primary-key and masked columns read-only, and only changed fields submitted),
 * and `delete` (no fields, just the confirmation).
 *
 * Writes never happen here: `onSubmit(values)` hands the payload to the grid,
 * and when the server answers 409 the grid passes the `confirm` payload back in
 * — then this component shows the generated statement behind a typed
 * `grid.confirmWord` gate and calls `onConfirm(token)`.
 *
 * Raw form elements on purpose: this module ships standalone, so it carries no
 * dependency on the host app's component kit.
 *
 * @param {{
 *   mode: 'create'|'update'|'delete',
 *   columns: Array<object>,
 *   row: object|null,
 *   onCancel: () => void,
 *   onSubmit: (values: Record<string, unknown>) => Promise<void>|void,
 *   pending?: boolean,
 *   error?: string|null,
 *   confirm?: {statement: string, token: string}|null,
 *   onConfirm?: (token: string) => Promise<void>|void,
 * }} props
 */
export function RowForm({
  mode,
  columns,
  row,
  onCancel,
  onSubmit,
  pending = false,
  error = null,
  confirm = null,
  onConfirm,
}) {
  const t = useStrings()
  const cols = useMemo(() => columns ?? [], [columns])
  const [fields, setFields] = useState(() => seedFields(cols, row, mode))
  const [word, setWord] = useState('')
  const [notice, setNotice] = useState(null)

  const confirmWord = t('grid.confirmWord')
  const title = t(
    mode === 'create'
      ? 'grid.createTitle'
      : mode === 'delete'
        ? 'grid.deleteTitle'
        : 'grid.updateTitle',
  )

  const setField = (name, patch) =>
    setFields((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))

  const submit = (event) => {
    event.preventDefault()
    if (pending) {
      return
    }
    const values = mode === 'delete' ? {} : buildValues(cols, fields, row, mode)
    if (mode === 'update' && Object.keys(values).length === 0) {
      setNotice(t('grid.noChanges'))
      return
    }
    setNotice(null)
    onSubmit(values)
  }

  return (
    <Shell title={title} icon={mode === 'delete' ? AlertIcon : null}>
      {confirm ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending && word.trim() === confirmWord) {
              onConfirm?.(confirm.token)
            }
          }}
        >
          <div className="dc-form-confirm">
            <p className="dc-form-intro">{t('grid.confirmIntro')}</p>
            <pre className="dc-form-statement">
              {confirm.statement}
            </pre>
            <label className="dc-form-confirm-label">
              <span>{t('grid.confirmPrompt', { word: confirmWord })}</span>
              <input
                value={word}
                onChange={(event) => setWord(event.target.value)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="dc-form-control narrow"
              />
            </label>
            {error && <ErrorLine>{error}</ErrorLine>}
          </div>
          <Footer>
            <GhostButton onClick={onCancel}>{t('grid.cancel')}</GhostButton>
            <PrimaryButton disabled={pending || word.trim() !== confirmWord} danger>
              {pending ? t('grid.working') : t('grid.confirm')}
            </PrimaryButton>
          </Footer>
        </form>
      ) : (
        <form onSubmit={submit}>
          <div className="dc-form-body">
            {mode === 'delete' ? (
              <div className="dc-form-delete">
                <p className="dc-form-delete-prompt">{t('grid.deletePrompt')}</p>
                <div className="dc-form-keys">
                  {cols
                    .filter((col) => col.pk)
                    .map((col) => (
                      <span key={col.name} className="dc-form-key">
                        <span className="dc-form-key-name">{col.name}</span>
                        <span className="dc-form-key-eq"> = </span>
                        <span className="dc-form-key-val">{toText(row?.[col.name])}</span>
                      </span>
                    ))}
                </div>
              </div>
            ) : (
              <div className="dc-form-grid">
                {cols.map((col) => (
                  <Field
                    key={col.name}
                    column={col}
                    mode={mode}
                    field={fields[col.name] ?? { text: '', nulled: false }}
                    masked={isMasked(col, row, mode)}
                    onChange={(patch) => setField(col.name, patch)}
                  />
                ))}
              </div>
            )}
            {(error ?? notice) && (
              <div className="dc-form-error-wrap">
                <ErrorLine>{error ?? notice}</ErrorLine>
              </div>
            )}
          </div>
          <Footer>
            <GhostButton onClick={onCancel}>{t('grid.cancel')}</GhostButton>
            <PrimaryButton disabled={pending} danger={mode === 'delete'}>
              {pending
                ? t('grid.working')
                : t(
                    mode === 'create'
                      ? 'grid.insert'
                      : mode === 'delete'
                        ? 'grid.delete'
                        : 'grid.save',
                  )}
            </PrimaryButton>
          </Footer>
        </form>
      )}
    </Shell>
  )
}

function Field({ column, mode, field, masked, onChange }) {
  const t = useStrings()
  const id = `dc-row-${column.name}`
  const kind = fieldKind(column.type)
  const locked = masked || (mode === 'update' && Boolean(column.pk))
  const disabled = locked || field.nulled
  const hasDefault = column.default !== null && column.default !== undefined
  const shared = {
    id,
    disabled,
    value: field.text,
    onChange: (event) => onChange({ text: event.target.value }),
    className: cx('dc-form-control', disabled && 'off'),
  }

  const control = () => {
    if (kind === 'boolean') {
      return (
        <select {...shared}>
          <option value="">–</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )
    }
    if (kind === 'json') {
      return <textarea {...shared} rows={3} spellCheck={false} />
    }
    return (
      <input
        {...shared}
        type={inputType(kind, field.text)}
        step={kind === 'number' ? 'any' : undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder={hasDefault && mode === 'create' ? String(column.default) : undefined}
      />
    )
  }

  return (
    <div className="dc-form-field">
      <div className="dc-form-field-head">
        {column.pk && <KeyIcon className="dc-form-key-icon" />}
        {masked && (
          <LockIcon className="dc-form-lock-icon" />
        )}
        <label htmlFor={id} className="dc-form-label">
          {column.name}
        </label>
        <span className="dc-form-type">
          {column.type}
        </span>
        {!column.nullable && (
          <span className="dc-form-notnull">{t('common.notNull')}</span>
        )}
      </div>
      {control()}
      <div className="dc-form-meta">
        {column.nullable && !locked && (
          <label className="dc-form-null-toggle">
            <input
              type="checkbox"
              checked={field.nulled}
              onChange={(event) => onChange({ nulled: event.target.checked })}
            />
            {t('grid.nullToggle')}
          </label>
        )}
        {masked && <span>{t('grid.maskedColumn')}</span>}
        {!masked && mode === 'update' && column.pk && <span>{t('grid.primaryKeyField')}</span>}
        {!locked && mode === 'create' && hasDefault && (
          <span>{t('grid.defaultHint', { value: String(column.default) })}</span>
        )}
      </div>
    </div>
  )
}

function Shell({ title, icon: Icon, children }) {
  return (
    <div className="dc-form-overlay">
      <div
        role="dialog"
        aria-modal="true"
        className="dc-form-dialog"
      >
        <div className="dc-form-header">
          {Icon && <Icon className="dc-form-header-icon" />}
          <h3 className="dc-form-title">{title}</h3>
        </div>
        {children}
      </div>
    </div>
  )
}

function Footer({ children }) {
  return (
    <div className="dc-form-footer">
      {children}
    </div>
  )
}

function GhostButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dc-btn"
    >
      {children}
    </button>
  )
}

function PrimaryButton({ disabled, danger, children }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={cx('dc-btn', danger ? 'dc-form-danger' : 'primary')}
    >
      {children}
    </button>
  )
}

function ErrorLine({ children }) {
  return (
    <p className="dc-form-error">
      <AlertIcon className="dc-form-error-icon" />
      <span>{children}</span>
    </p>
  )
}

/** @returns {'number'|'boolean'|'json'|'datetime'|'date'|'text'} */
function fieldKind(type) {
  const name = String(type ?? '').toLowerCase()
  if (name.includes('json')) {
    return 'json'
  }
  if (name.startsWith('bool')) {
    return 'boolean'
  }
  if (name.includes('timestamp') || name.includes('datetime')) {
    return 'datetime'
  }
  if (name.includes('date')) {
    return 'date'
  }
  return isNumericType(name) ? 'number' : 'text'
}

/**
 * `datetime-local` / `date` only when the current text fits the input's format —
 * anything else (a timezone offset, an expression) stays a plain text input so
 * the value is never silently mangled.
 */
function inputType(kind, text) {
  if (kind === 'number') {
    return 'number'
  }
  if (kind === 'datetime') {
    return text === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)
      ? 'datetime-local'
      : 'text'
  }
  if (kind === 'date') {
    return text === '' || /^\d{4}-\d{2}-\d{2}$/.test(text) ? 'date' : 'text'
  }
  return 'text'
}

function isMasked(column, row, mode) {
  return mode !== 'create' && row?.[column.name] === MASK
}

function toText(value) {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

/** Seed one `{text, nulled}` entry per column — blank on create, the row's value on update. */
function seedFields(columns, row, mode) {
  const fields = {}
  columns.forEach((column) => {
    const value = mode === 'create' ? undefined : row?.[column.name]
    fields[column.name] = {
      text: normalize(fieldKind(column.type), toText(value)),
      nulled: mode !== 'create' && value === null,
    }
  })
  return fields
}

/** `2026-07-30 09:15:00` → `2026-07-30T09:15:00`, so `datetime-local` accepts it. */
function normalize(kind, text) {
  if (kind !== 'datetime') {
    return text
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/.exec(text)
  return match ? `${match[1]}T${match[2]}` : text
}

/**
 * The payload: only the fields the user actually set (create) or changed
 * (update). A blank, un-nulled field is left out entirely — that's what makes
 * "use the column default" different from "store NULL".
 *
 * @returns {Record<string, unknown>}
 */
function buildValues(columns, fields, row, mode) {
  const values = {}

  columns.forEach((column) => {
    if (isMasked(column, row, mode) || (mode === 'update' && column.pk)) {
      return
    }

    const field = fields[column.name] ?? { text: '', nulled: false }
    const original = mode === 'update' ? (row?.[column.name] ?? null) : undefined
    const kind = fieldKind(column.type)

    if (field.nulled) {
      if (mode === 'create' || original !== null) {
        values[column.name] = null
      }
      return
    }

    const text = field.text
    if (text === '' && (mode === 'create' || kind !== 'text')) {
      return
    }
    if (mode === 'update' && text === normalize(kind, toText(original))) {
      return
    }

    values[column.name] = parseValue(kind, text)
  })

  return values
}

function parseValue(kind, text) {
  if (kind === 'boolean') {
    return text === 'true'
  }
  if (kind === 'number') {
    const number = Number(text)
    return Number.isFinite(number) ? number : text
  }
  if (kind === 'datetime') {
    return text.replace('T', ' ')
  }
  return text
}
