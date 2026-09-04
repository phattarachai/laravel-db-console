import { useEffect, useRef, useState } from 'react'

import { defaultOperatorFor, operatorsFor, valueShapeFor } from './filter-lib'
import { CloseIcon, KeyIcon, LinkIcon, PlusIcon, SearchIcon } from './icons'
import { cx } from './lib'
import { useStrings } from './strings'

/**
 * Adminer-style per-field filter builder, split into two placeable pieces that
 * share the same controlled `value` (the working conditions) / `onChange`:
 *
 *   {@link FilterAddButton}  the "+ filter" trigger + column menu, sits in the
 *                            grid toolbar next to the search box.
 *   {@link FilterConditions} the row of active conditions + "clear all", shown
 *                            under the header only once there is a condition.
 *
 * Each condition names a column, an operator scoped to that column's type (see
 * `filter-lib`), and its value(s); the whole set is ANDed. The parent grid owns
 * the state and the wire payload (`toPayload`); these only render it.
 */

/**
 * @param {{
 *   columns: Array<{name: string, type: string, pk?: boolean, fk?: string|null}>,
 *   value: Array,
 *   onChange: (conditions: Array) => void,
 * }} props
 */
export function FilterAddButton({ columns, value, onChange }) {
  const [open, setOpen] = useState(false)

  const addCondition = (column) => {
    setOpen(false)
    onChange([
      ...value,
      {
        id: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        column: column.name,
        type: column.type,
        operator: defaultOperatorFor(column.type),
        value: '',
      },
    ])
  }

  return <ColumnPicker columns={columns} open={open} onOpen={setOpen} onPick={addCondition} />
}

/**
 * @param {{ value: Array, onChange: (conditions: Array) => void }} props
 */
export function FilterConditions({ value, onChange }) {
  const t = useStrings()

  const updateCondition = (id, patch) =>
    onChange(value.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const removeCondition = (id) => onChange(value.filter((c) => c.id !== id))

  if (value.length === 0) {
    return null
  }

  return (
    <>
      {value.map((condition) => (
        <Condition
          key={condition.id}
          condition={condition}
          onChange={(patch) => updateCondition(condition.id, patch)}
          onRemove={() => removeCondition(condition.id)}
        />
      ))}
      <button type="button" className="dc-filter-clear" onClick={() => onChange([])}>
        {t('filter.clearAll')}
      </button>
    </>
  )
}

/** One condition row: column chip · operator select · value editor · remove. */
function Condition({ condition, onChange, onRemove }) {
  const t = useStrings()
  const { column, type, operator } = condition
  const shape = valueShapeFor(operator, type)

  const changeOperator = (nextOperator) => {
    const next = valueShapeFor(nextOperator, type)
    onChange({ operator: nextOperator, value: emptyValueFor(next.kind) })
  }

  return (
    <div className="dc-filter-cond">
      <span className="dc-filter-col dc-grid-mono" title={column}>
        {column}
      </span>

      <select
        className="dc-filter-op"
        value={operator}
        onChange={(e) => changeOperator(e.target.value)}
        aria-label={t('filter.operator')}
      >
        {operatorsFor(type).map((op) => (
          <option key={op} value={op}>
            {t(`filter.op.${op}`)}
          </option>
        ))}
      </select>

      <ValueEditor shape={shape} value={condition.value} onChange={(v) => onChange({ value: v })} />

      <button
        type="button"
        className="dc-filter-remove"
        onClick={onRemove}
        title={t('filter.remove')}
        aria-label={t('filter.remove')}
      >
        <CloseIcon className="dc-grid-icon-sm" />
      </button>
    </div>
  )
}

function emptyValueFor(kind) {
  if (kind === 'pair') {
    return ['', '']
  }
  if (kind === 'list') {
    return ['']
  }
  return ''
}

/** The value input(s) for one condition, driven by its `shape`. */
function ValueEditor({ shape, value, onChange }) {
  const t = useStrings()

  if (shape.kind === 'none') {
    return null
  }

  if (shape.kind === 'pair') {
    const pair = Array.isArray(value) ? value : ['', '']
    return (
      <span className="dc-filter-pair">
        <input
          className="dc-input dc-filter-val"
          type={shape.input}
          value={pair[0] ?? ''}
          onChange={(e) => onChange([e.target.value, pair[1] ?? ''])}
          placeholder={t('filter.from')}
        />
        <span className="dc-filter-dash">–</span>
        <input
          className="dc-input dc-filter-val"
          type={shape.input}
          value={pair[1] ?? ''}
          onChange={(e) => onChange([pair[0] ?? '', e.target.value])}
          placeholder={t('filter.to')}
        />
      </span>
    )
  }

  if (shape.kind === 'list') {
    const joined = Array.isArray(value) ? value.join(', ') : ''
    return (
      <input
        className="dc-input dc-filter-val dc-filter-val-wide"
        type="text"
        value={joined}
        onChange={(e) => onChange(e.target.value.split(',').map((v) => v.trim()))}
        placeholder={t('filter.listHint')}
      />
    )
  }

  return (
    <input
      className="dc-input dc-filter-val"
      type={shape.input}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('filter.value')}
    />
  )
}

/** The "+ filter" button and its searchable column menu. */
function ColumnPicker({ columns, open, onOpen, onPick }) {
  const t = useStrings()
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return
    }
    inputRef.current?.focus()
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) {
        onOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpen])

  const q = query.trim().toLowerCase()
  const matches = q ? columns.filter((c) => c.name.toLowerCase().includes(q)) : columns

  return (
    <div className="dc-filter-picker" ref={ref}>
      <button
        type="button"
        className={cx('dc-filter-add', open && 'on')}
        onClick={() => onOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PlusIcon className="dc-grid-icon-sm" />
        {t('filter.add')}
      </button>

      {open && (
        <div className="dc-filter-menu" role="menu" aria-label={t('filter.add')}>
          <div className="dc-filter-search">
            <SearchIcon className="dc-filter-search-icon" />
            <input
              ref={inputRef}
              className="dc-input dc-filter-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('filter.searchColumns')}
            />
          </div>
          <div className="dc-filter-cols">
            {matches.map((column) => (
              <button
                key={column.name}
                type="button"
                role="menuitem"
                className="dc-grid-menu-item"
                onClick={() => onPick(column)}
              >
                {column.pk && <KeyIcon className="dc-grid-key-icon" />}
                {column.fk && !column.pk && <LinkIcon className="dc-grid-faint-icon" />}
                <span className="dc-grid-mono">{column.name}</span>
                <span className="dc-filter-coltype">{column.type}</span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="dc-filter-nocols">{t('filter.noColumns', { search: query })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
