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
  key: 'tw:text-[var(--dc-syntax-keyword)]',
  string: 'tw:text-[var(--dc-syntax-string)]',
  number: 'tw:text-[var(--dc-syntax-number)]',
  literal: 'tw:text-[var(--dc-null)]',
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
    <div className="tw:relative tw:flex tw:shrink-0 tw:flex-col" style={{ width }}>
      {/* Grab handle: 5px of hit area straddling the panel's left border. */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(WIDTH_DEFAULT)}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('drawer.resize')}
        title={t('drawer.resize')}
        className="tw:absolute tw:top-0 tw:bottom-0 tw:-left-0.5 tw:z-20 tw:w-1.5 tw:cursor-col-resize tw:hover:bg-[var(--dc-accent)]"
      />
      <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-y-auto tw:border-l tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)]">
        <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:shrink-0 tw:flex-col tw:gap-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)] tw:px-3 tw:py-2">
          <div className="tw:flex tw:items-start tw:gap-2">
            <ColumnIcon className="tw:mt-0.5 tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
            <div className="tw:min-w-0 tw:flex-1">
              <p className="tw:truncate tw:font-mono tw:text-xs tw:font-semibold tw:text-[var(--dc-text)]">
                {column?.name}
              </p>
              {column?.type && (
                <p className="tw:truncate tw:font-mono tw:text-[11px] tw:text-[var(--dc-text-faint)] tw:lowercase">
                  {column.type}
                </p>
              )}
            </div>
            <div className="tw:ml-auto tw:flex tw:shrink-0 tw:items-center tw:gap-0.5">
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
            <div className="tw:flex tw:items-center tw:gap-0.5 tw:self-start tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:p-0.5">
              <ModeButton active={mode === 'pretty'} onClick={() => setMode('pretty')}>
                {t('drawer.pretty')}
              </ModeButton>
              <ModeButton active={mode === 'raw'} onClick={() => setMode('raw')}>
                {t('drawer.raw')}
              </ModeButton>
            </div>
          )}

          {copied && (
            <p className="tw:text-[11px] tw:text-[var(--dc-accent)]">{t('drawer.copied')}</p>
          )}
        </div>

        <div className="tw:flex-1 tw:px-3 tw:py-3">
          {isNull ? (
            <span className="tw:font-mono tw:text-xs tw:italic tw:text-[var(--dc-null)]">
              {t('drawer.null')}
            </span>
          ) : raw === '' ? (
            <span className="tw:text-xs tw:italic tw:text-[var(--dc-text-faint)]">
              {t('drawer.empty')}
            </span>
          ) : showPretty ? (
            <pre className="tw:font-mono tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words tw:text-[var(--dc-text)] tw:select-text">
              {highlighted ?? pretty}
            </pre>
          ) : isJson ? (
            <pre className="tw:font-mono tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words tw:text-[var(--dc-text)] tw:select-text">
              {raw}
            </pre>
          ) : (
            <div className="tw:font-mono tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:break-words tw:text-[var(--dc-text)] tw:select-text">
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
      className={cx(
        'tw:flex tw:h-6 tw:w-6 tw:items-center tw:justify-center tw:rounded tw:hover:bg-[var(--dc-hover)]',
        active
          ? 'tw:text-[var(--dc-accent)]'
          : 'tw:text-[var(--dc-text-muted)] tw:hover:text-[var(--dc-text)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
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
      className={cx(
        'tw:rounded tw:px-2 tw:py-0.5 tw:text-[11px] tw:font-medium',
        active
          ? 'tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]'
          : 'tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]',
      )}
    >
      {children}
    </button>
  )
}
