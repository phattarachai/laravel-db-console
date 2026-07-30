import { useEffect, useRef, useState } from 'react'

import { AlertIcon, ChevronIcon, DatabaseIcon, LockIcon } from './icons'
import { cx } from './lib'
import { useStrings } from './strings'

/**
 * Toolbar connection controls — the pill that names the live connection and, when
 * the host app exposes more than one, the dropdown that switches between them.
 *
 * Switching is a **full page load** (`?conn=<key>` on the index endpoint): the
 * schema tree, grid and SQL console all belong to one connection, so the whole
 * tree is replaced rather than patched.
 *
 * No dependencies beyond React + `cx` — the module stays drop-in portable.
 */

/** Shared pill chrome so the static and interactive variants look identical. */
const PILL =
  'tw:flex tw:items-center tw:gap-1.5 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1 tw:text-xs tw:text-[var(--dc-text-muted)]'

/**
 * The read-only marker inside the pill: a faint lock, and nothing at all when the
 * connection is writable — write is the mode you opted into, so it needs no badge.
 * The dropdown rows still label both modes.
 */
function ReadLock({ mode }) {
  const t = useStrings()

  if (mode === 'write') {
    return null
  }

  return (
    <>
      <span className="tw:text-[var(--dc-border)]">·</span>
      <LockIcon
        className="tw:h-3.5 tw:w-3.5 tw:text-[var(--dc-text-faint)]"
        aria-label={t('toolbar.modeRead')}
      />
    </>
  )
}

/** The same read/write signal, chip-sized, for the rows inside the dropdown. */
function ModeChip({ mode }) {
  const t = useStrings()
  const writable = mode === 'write'

  return (
    <span
      className={cx(
        'tw:ml-auto tw:shrink-0 tw:rounded tw:border tw:px-1.5 tw:py-0.5 tw:text-[10px]',
        writable
          ? 'tw:border-amber-500/40 tw:bg-amber-500/10 tw:font-semibold tw:text-amber-600'
          : 'tw:border-[var(--dc-border)] tw:text-[var(--dc-text-muted)]',
      )}
    >
      {t(writable ? 'toolbar.modeWrite' : 'toolbar.modeRead')}
    </span>
  )
}

/** The non-interactive pill: what the single-connection console has always shown. */
function ConnectionPill({ connection }) {
  const t = useStrings()

  return (
    <div className={PILL} title={connection.mode === 'write' ? undefined : t('toolbar.modeRead')}>
      <DatabaseIcon className="tw:h-3.5 tw:w-3.5 tw:text-[var(--dc-table-icon)]" />
      <span className="tw:font-mono tw:text-[var(--dc-text)]">
        {connection.database ?? connection.label ?? connection.key}
      </span>
      {connection.driver && (
        <span className="tw:text-[var(--dc-text-faint)]">· {connection.driver}</span>
      )}
      <ReadLock mode={connection.mode} />
    </div>
  )
}

/**
 * @param {object} props
 * @param {Array<{key: string, label?: string, database?: string, driver?: string, mode?: string, error?: string}>} [props.connections]
 * @param {{key: string, label?: string, database?: string, driver?: string, mode?: string} | null} [props.connection] the live one
 * @param {string} [props.indexEndpoint] console index URL; `?conn=<key>` is set on it to switch.
 */
export function ConnectionPicker({ connections, connection, indexEndpoint }) {
  const t = useStrings()
  const list = Array.isArray(connections) ? connections : []
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Outside click / Escape close. Bound only while open so the console adds no
  // document listeners in its resting state.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // One connection (or none) → the plain pill, exactly as before.
  if (list.length <= 1) {
    return connection ? <ConnectionPill connection={connection} /> : null
  }

  const select = (item) => {
    if (item.error || item.key === connection?.key) {
      setOpen(false)
      return
    }
    const base = indexEndpoint ?? window.location.href
    const url = new URL(base, window.location.origin)
    url.searchParams.set('conn', item.key)
    window.location.assign(url.toString())
  }

  return (
    <div ref={rootRef} className="tw:relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('toolbar.switchConnection')}
        className={cx(PILL, 'tw:hover:bg-[var(--dc-hover)]')}
      >
        <DatabaseIcon className="tw:h-3.5 tw:w-3.5 tw:text-[var(--dc-table-icon)]" />
        <span className="tw:font-mono tw:text-[var(--dc-text)]">
          {connection?.database ?? connection?.label ?? connection?.key ?? '—'}
        </span>
        {connection?.driver && (
          <span className="tw:text-[var(--dc-text-faint)]">· {connection.driver}</span>
        )}
        <ReadLock mode={connection?.mode} />
        <ChevronIcon
          className={cx(
            'tw:h-3 tw:w-3 tw:text-[var(--dc-text-faint)]',
            open ? 'tw:-rotate-90' : 'tw:rotate-90',
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="tw:absolute tw:top-full tw:left-0 tw:z-30 tw:mt-1 tw:max-h-80 tw:w-72 tw:overflow-y-auto tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:py-1 tw:shadow-lg"
        >
          {list.map((item) => {
            const active = item.key === connection?.key
            const broken = Boolean(item.error)

            return (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={active}
                disabled={broken}
                title={item.error ?? undefined}
                onClick={() => select(item)}
                className={cx(
                  'tw:flex tw:w-full tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:text-left tw:text-xs',
                  broken
                    ? 'tw:cursor-not-allowed tw:text-[var(--dc-text-faint)]'
                    : 'tw:text-[var(--dc-text)] tw:hover:bg-[var(--dc-hover)]',
                  active && 'tw:bg-[var(--dc-accent-soft)]',
                )}
              >
                <span className="tw:truncate tw:font-medium">{item.label || item.key}</span>
                {item.database && (
                  <span className="tw:truncate tw:font-mono tw:text-[var(--dc-text-muted)]">
                    {item.database}
                  </span>
                )}
                {broken ? (
                  <AlertIcon className="tw:ml-auto tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-danger,#dc2626)]" />
                ) : (
                  <ModeChip mode={item.mode} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
