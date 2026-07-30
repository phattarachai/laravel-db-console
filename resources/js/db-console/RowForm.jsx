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
          <div className="tw:flex tw:flex-col tw:gap-3 tw:px-4 tw:py-4">
            <p className="tw:text-xs tw:text-[var(--dc-text-muted)]">{t('grid.confirmIntro')}</p>
            <pre className="tw:max-h-56 tw:overflow-auto tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-3 tw:py-2 tw:font-mono tw:text-xs tw:whitespace-pre-wrap tw:text-[var(--dc-text)]">
              {confirm.statement}
            </pre>
            <label className="tw:flex tw:flex-col tw:gap-1 tw:text-xs tw:text-[var(--dc-text-muted)]">
              <span>{t('grid.confirmPrompt', { word: confirmWord })}</span>
              <input
                value={word}
                onChange={(event) => setWord(event.target.value)}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                className="tw:w-40 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1.5 tw:font-mono tw:text-xs tw:text-[var(--dc-text)] tw:outline-none tw:focus:border-[var(--dc-accent)]"
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
          <div className="tw:max-h-[60vh] tw:overflow-auto tw:px-4 tw:py-4">
            {mode === 'delete' ? (
              <div className="tw:flex tw:flex-col tw:gap-2">
                <p className="tw:text-xs tw:text-[var(--dc-text)]">{t('grid.deletePrompt')}</p>
                <div className="tw:flex tw:flex-wrap tw:gap-x-4 tw:gap-y-1 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-3 tw:py-2">
                  {cols
                    .filter((col) => col.pk)
                    .map((col) => (
                      <span key={col.name} className="tw:font-mono tw:text-xs">
                        <span className="tw:text-[var(--dc-text-muted)]">{col.name}</span>
                        <span className="tw:text-[var(--dc-text-faint)]"> = </span>
                        <span className="tw:text-[var(--dc-text)]">{toText(row?.[col.name])}</span>
                      </span>
                    ))}
                </div>
              </div>
            ) : (
              <div className="tw:grid tw:gap-4 tw:sm:grid-cols-2">
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
              <div className="tw:pt-3">
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
    className: cx(
      'tw:w-full tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1.5 tw:font-mono tw:text-xs tw:text-[var(--dc-text)] tw:outline-none tw:focus:border-[var(--dc-accent)]',
      disabled && 'tw:opacity-50',
    ),
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
    <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-1">
      <div className="tw:flex tw:items-center tw:gap-1.5">
        {column.pk && <KeyIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-key)]" />}
        {masked && (
          <LockIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
        )}
        <label htmlFor={id} className="tw:font-mono tw:text-xs tw:text-[var(--dc-text)]">
          {column.name}
        </label>
        <span className="tw:font-mono tw:text-[10px] tw:lowercase tw:text-[var(--dc-text-faint)]">
          {column.type}
        </span>
        {!column.nullable && (
          <span className="tw:text-[10px] tw:text-[var(--dc-key)]">{t('common.notNull')}</span>
        )}
      </div>
      {control()}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-[10px] tw:text-[var(--dc-text-faint)]">
        {column.nullable && !locked && (
          <label className="tw:flex tw:items-center tw:gap-1 tw:text-[var(--dc-text-muted)]">
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
    <div className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-start tw:justify-center tw:overflow-auto tw:bg-[rgba(0,0,0,0.55)] tw:p-6">
      <div
        role="dialog"
        aria-modal="true"
        className="tw:w-full tw:max-w-3xl tw:overflow-hidden tw:rounded-lg tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:shadow-2xl"
      >
        <div className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)] tw:px-4 tw:py-2.5">
          {Icon && <Icon className="tw:h-4 tw:w-4 tw:text-[var(--dc-key)]" />}
          <h3 className="tw:text-sm tw:font-semibold tw:text-[var(--dc-text)]">{title}</h3>
        </div>
        {children}
      </div>
    </div>
  )
}

function Footer({ children }) {
  return (
    <div className="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:border-t tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-4 tw:py-2.5">
      {children}
    </div>
  )
}

function GhostButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-3 tw:py-1.5 tw:text-xs tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]"
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
      className={cx(
        'tw:rounded-md tw:px-3 tw:py-1.5 tw:text-xs tw:font-semibold tw:disabled:opacity-40',
        danger
          ? 'tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:text-[var(--dc-key)] tw:hover:bg-[var(--dc-hover)]'
          : 'tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]',
      )}
    >
      {children}
    </button>
  )
}

function ErrorLine({ children }) {
  return (
    <p className="tw:flex tw:items-start tw:gap-1.5 tw:text-xs tw:text-[var(--dc-key)]">
      <AlertIcon className="tw:mt-px tw:h-3.5 tw:w-3.5 tw:shrink-0" />
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
