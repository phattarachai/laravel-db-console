import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronIcon, ColumnIcon, LinkIcon } from './icons'
import { cx } from './lib'
import { useStrings } from './strings'

/**
 * One JSON token per match. Group 1 = a quoted string, group 2 = the `:` that
 * makes it an object key (kept out of the coloured span so punctuation stays the
 * normal text colour), group 3 = a number, group 4 = `true`/`false`/`null`.
 *
 * Strings are matched before numbers/literals and the scan is left-to-right, so
 * digits or the word `null` inside a string are swallowed by the string token.
 */
const JSON_TOKENS =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

const TOKEN_CLASS = {
  key: 'dc-drawer-tok-key',
  string: 'dc-drawer-tok-string',
  number: 'dc-drawer-tok-number',
  literal: 'dc-drawer-tok-literal',
}

/** How long the “copied” confirmation stays up, in ms. */
const COPIED_MS = 1600

/** Drag-to-resize: persisted width, and the range it is clamped to. */
const WIDTH_KEY = 'dc.drawer.width.v1'
const WIDTH_DEFAULT = 288
const WIDTH_MIN = 220
const WIDTH_MAX = 900

/** Lazy `useState` initialiser — the first paint already uses the saved width. */
function readWidth() {
  if (typeof window === 'undefined') {
    return WIDTH_DEFAULT
  }
  const stored = Number(window.localStorage.getItem(WIDTH_KEY))
  if (!Number.isFinite(stored) || stored <= 0) {
    return WIDTH_DEFAULT
  }
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, stored))
}

/**
 * Inspector panel for a single grid cell — the full value of one cell, readable
 * and selectable, next to the grid rather than over it. The caller drops it into
 * a flex row (it renders its own bordered, fixed-width, scrolling column), so
 * there is no backdrop, no `fixed`, and no portal.
 *
 * A JSON value (json/jsonb column, or any string that parses to an object or an
 * array) gets a Pretty | Raw toggle; Pretty is syntax highlighted by the local
 * tokenizer below — no highlighting dependency. Anything the parser or the
 * tokenizer chokes on degrades to the raw string.
 *
 * @param {{name: string, type: string}} column the clicked cell's column
 * @param {string|number|boolean|null} value the raw cell value
 * @param {() => void} onClose close button handler
 */
export function CellDrawer({ column, value, onClose }) {
  const t = useStrings()
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState('pretty')
  const [width, setWidth] = useState(readWidth)
  const copiedTimer = useRef(null)

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  /**
   * Drag the left edge to resize. Listeners live on `window` for the duration of
   * the drag only, and the final width is written to localStorage — a per-client
   * preference, so nothing server-side knows about it.
   */
  const startResize = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    let latest = startWidth

    const onMove = (move) => {
      latest = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startWidth + (startX - move.clientX)))
      setWidth(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        window.localStorage.setItem(WIDTH_KEY, String(Math.round(latest)))
      } catch {
        // Private mode / quota — the width just won't survive a reload.
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const isNull = value === null || value === undefined
  const raw = useMemo(() => stringifyRaw(value), [value])
  const pretty = useMemo(() => prettyJson(raw, column?.type), [raw, column?.type])
  const highlighted = useMemo(() => highlightJson(pretty), [pretty])

  const isJson = pretty !== null
  const showPretty = isJson && mode === 'pretty'

  async function copy() {
    const clipboard = globalThis.navigator?.clipboard
    if (!clipboard?.writeText) {
      return
    }
    try {
      await clipboard.writeText(raw)
      clearTimeout(copiedTimer.current)
      setCopied(true)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // Clipboard denied (insecure context, no permission) — stay silent.
    }
  }

  return (
    <div className="dc-drawer-root" style={{ width }}>
      {/* Grab handle: 5px of hit area straddling the panel's left border. */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(WIDTH_DEFAULT)}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('drawer.resize')}
        title={t('drawer.resize')}
        className="dc-drawer-handle"
      />
      <div className="dc-drawer-panel">
        <div className="dc-drawer-header">
          <div className="dc-drawer-title-row">
            <ColumnIcon className="dc-drawer-title-icon" />
            <div className="dc-cell">
              <p className="dc-drawer-name">
                {column?.name}
              </p>
              {column?.type && (
                <p className="dc-drawer-type">
                  {column.type}
                </p>
              )}
            </div>
            <div className="dc-drawer-actions">
              <HeaderButton
                onClick={copy}
                label={copied ? t('drawer.copied') : t('drawer.copy')}
                icon={copied ? CheckIcon : LinkIcon}
                active={copied}
              />
              <HeaderButton onClick={onClose} label={t('drawer.close')} icon={ChevronIcon} />
            </div>
          </div>

          {isJson && (
            <div className="dc-drawer-modes">
              <ModeButton active={mode === 'pretty'} onClick={() => setMode('pretty')}>
                {t('drawer.pretty')}
              </ModeButton>
              <ModeButton active={mode === 'raw'} onClick={() => setMode('raw')}>
                {t('drawer.raw')}
              </ModeButton>
            </div>
          )}

          {copied && (
            <p className="dc-drawer-copied">{t('drawer.copied')}</p>
          )}
        </div>

        <div className="dc-drawer-body">
          {isNull ? (
            <span className="dc-drawer-null">
              {t('drawer.null')}
            </span>
          ) : raw === '' ? (
            <span className="dc-drawer-empty">
              {t('drawer.empty')}
            </span>
          ) : showPretty ? (
            <pre className="dc-drawer-content">
              {highlighted ?? pretty}
            </pre>
          ) : isJson ? (
            <pre className="dc-drawer-content">
              {raw}
            </pre>
          ) : (
            <div className="dc-drawer-content">
              {raw}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The raw text of a cell — what Copy writes, and what Raw shows verbatim. */
function stringifyRaw(value) {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'object') {
    // Defensive: the grid hands over scalars, but a pre-parsed payload is cheap
    // to survive rather than render as `[object Object]`.
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * `JSON.stringify(parsed, null, 2)` when the cell really is JSON, else `null`.
 *
 * JSON means: the column type mentions `json` (so `json` and `jsonb` both hit),
 * **or** the text itself parses into an object/array. A bare number, `"null"` or
 * a quoted string is text, not JSON — and a `json` column holding something
 * unparseable falls back to text too, never an error.
 */
function prettyJson(raw, type) {
  const looksLikeJson = /^[[{]/.test(raw.trim())
  if (!looksLikeJson && !/json/i.test(type ?? '')) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

/**
 * Wrap every JSON token of the pretty-printed text in a coloured `<span>`,
 * returning a React node array (no `dangerouslySetInnerHTML`). Punctuation —
 * braces, brackets, commas, colons — is left as plain text so it inherits the
 * normal colour. Returns `null` if there is nothing to highlight or anything
 * goes wrong, and the caller then prints the plain text.
 */
function highlightJson(pretty) {
  if (pretty === null) {
    return null
  }
  try {
    const nodes = []
    let cursor = 0
    let seq = 0
    for (const match of pretty.matchAll(JSON_TOKENS)) {
      const [full, quoted, colon, number, literal] = match
      if (match.index > cursor) {
        nodes.push(pretty.slice(cursor, match.index))
      }
      const tone = quoted ? (colon ? 'key' : 'string') : number ? 'number' : 'literal'
      nodes.push(
        <span key={`t${seq++}`} className={TOKEN_CLASS[tone]}>
          {quoted ?? number ?? literal}
        </span>,
      )
      if (quoted && colon) {
        nodes.push(colon)
      }
      cursor = match.index + full.length
    }
    if (cursor < pretty.length) {
      nodes.push(pretty.slice(cursor))
    }
    return nodes
  } catch {
    return null
  }
}

/** Icon-only header action; `active` marks the copy button's brief confirmation. */
function HeaderButton({ onClick, label, icon: Icon, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx('dc-drawer-hbtn', active && 'on')}
    >
      <Icon className="dc-drawer-hbtn-icon" />
    </button>
  )
}

/** One cell of the Pretty | Raw segmented control. */
function ModeButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx('dc-drawer-mode', active && 'on')}
    >
      {children}
    </button>
  )
}
