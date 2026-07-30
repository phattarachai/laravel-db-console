import { useEffect, useMemo, useState } from 'react'

import { DataGrid } from './DataGrid'
import {
  AlertIcon,
  BookmarkIcon,
  CheckIcon,
  ClockIcon,
  EraserIcon,
  LinkIcon,
  LockIcon,
  PlayIcon,
  SaveIcon,
  TerminalIcon,
  TrashIcon,
  WandIcon,
} from './icons'
import { classifySql, formatSql } from './sql-lib'
import { cx, HISTORY_LIMIT } from './lib'
import { SqlEditor } from './SqlEditor'
import { useStrings } from './strings'

/**
 * The ad-hoc SQL console. Editor on top, tabbed results / plan / saved / history
 * below.
 *
 * Everything is server-backed: Run POSTs to `endpoints.query`, and saved queries,
 * run history, EXPLAIN plans and share links each have their own endpoint. Nothing
 * is kept in localStorage any more — the props are the state of record and a fresh
 * Inertia payload replaces whatever this component added optimistically.
 *
 * `classifySql(text, mode)` is the client-side mirror of the server's `SqlGuard`:
 * it disables Run and labels the chip, but the server guard is the real gate. On a
 * `confirm_writes` connection a write answers **409** with a single-use token — a
 * normal step, never an error — which the type-to-confirm panel replays.
 *
 * @param {{
 *   sql: {defaultQuery?: string, saved?: Array, history?: Array},
 *   endpoints?: {query: string, explain: string, row: string, share: string, saved: string, index: string},
 *   csrfToken?: string,
 *   editorRef?: import('react').RefObject,
 *   connectionKey?: string,
 *   mode?: 'read' | 'write',
 *   confirmWrites?: boolean,
 *   features?: {explain?: boolean, share?: boolean, rowEdit?: boolean},
 *   initialSql?: string,
 *   runEndpoint?: string,
 * }} props
 */
export function SqlConsole({
  sql,
  endpoints,
  csrfToken,
  editorRef,
  connectionKey,
  mode = 'read',
  confirmWrites = false,
  features,
  initialSql,
  runEndpoint,
}) {
  const t = useStrings()

  const queryUrl = endpoints?.query ?? runEndpoint
  const canExplain = Boolean(features?.explain && endpoints?.explain)
  const canShare = Boolean(features?.share && endpoints?.share)

  const [text, setText] = useState(() => initialSql || sql?.defaultQuery || '')
  const [result, setResult] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('result')
  const [running, setRunning] = useState(false)
  /** The pending 409 handshake: `{token, statement, sql}`. */
  const [confirm, setConfirm] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  /** The last share link: `{url, copied}`. */
  const [share, setShare] = useState(null)

  // Saved queries + history come from the server. Local state is only the thin
  // overlay of what happened in this session, laid over the props on every render
  // — so a fresh payload is picked up with no prop-syncing effect and no stale list.
  const [addedSaved, setAddedSaved] = useState([])
  const [removedSaved, setRemovedSaved] = useState([])
  const [ranHere, setRanHere] = useState([])

  const saved = useMemo(() => {
    const added = addedSaved.filter((q) => !removedSaved.includes(q.id))
    const addedIds = new Set(added.map((q) => q.id))

    return [
      ...added,
      ...(sql?.saved ?? []).filter((q) => !addedIds.has(q.id) && !removedSaved.includes(q.id)),
    ]
  }, [addedSaved, removedSaved, sql?.saved])

  const history = useMemo(() => {
    const server = sql?.history ?? []
    const seen = new Set(server.map(runKey))

    return [...ranHere.filter((h) => !seen.has(runKey(h))), ...server].slice(0, HISTORY_LIMIT)
  }, [ranHere, sql?.history])

  // "Link copied." is a flash, not a state.
  useEffect(() => {
    if (!share?.copied) {
      return undefined
    }
    const timer = setTimeout(() => setShare(null), 4000)
    return () => clearTimeout(timer)
  }, [share])

  const guard = classifySql(text, mode)
  const confirmWord = t('sql.confirmWord')
  const isEmpty = text.trim() === ''

  const dismissConfirm = () => {
    setConfirm(null)
    setConfirmText('')
  }

  const failWith = (data, status) => {
    // 422 is a guard / DB rejection and carries a localised `message`.
    setError({ kind: 'server', reason: data?.message ?? t('sql.error.request', { status }) })
    setTab('result')
  }

  /** Run one statement; `confirmToken` replays a statement the server asked to confirm. */
  const execute = async (raw, confirmToken = null) => {
    const check = classifySql(raw, mode)
    setTab('result')

    if (!check.ok) {
      setError({ ...check, kind: 'guard' })
      setResult(null)
      dismissConfirm()
      return
    }

    if (!queryUrl) {
      setError({ kind: 'server', reason: t('sql.error.noEndpoint') })
      setResult(null)
      return
    }

    setRunning(true)
    try {
      const body = { connection: connectionKey, sql: raw }
      if (confirmToken) {
        body.confirm_token = confirmToken
      }

      const { ok, status, data } = await send(queryUrl, 'POST', csrfToken, body)

      // 409 = type-to-confirm. Not an error: the identical body is replayed with
      // the token once the user has typed the confirmation word.
      if (status === 409 && data?.confirm) {
        setConfirm({ token: data.confirm.token, statement: data.confirm.statement, sql: raw })
        setConfirmText('')
        setError(null)
        return
      }

      if (!ok) {
        failWith(data, status)
        setResult(null)
        return
      }

      dismissConfirm()
      setError(null)
      setResult(data)
      setRanHere((list) => [historyEntry(raw, data, connectionKey), ...list])
    } catch (e) {
      setError({ kind: 'server', reason: e.message })
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const explain = async () => {
    const check = classifySql(text, mode)
    if (!check.ok) {
      setTab('result')
      setError({ ...check, kind: 'guard' })
      setResult(null)
      return
    }

    setRunning(true)
    try {
      const { ok, status, data } = await send(endpoints.explain, 'POST', csrfToken, {
        connection: connectionKey,
        sql: text,
      })
      if (!ok) {
        failWith(data, status)
        return
      }
      setPlan(data.plan ?? [])
      setError(null)
      setTab('plan')
    } catch (e) {
      setError({ kind: 'server', reason: e.message })
      setTab('result')
    } finally {
      setRunning(false)
    }
  }

  const shareCurrent = async () => {
    try {
      const { ok, status, data } = await send(endpoints.share, 'POST', csrfToken, {
        connection: connectionKey,
        sql: text,
      })
      if (!ok) {
        failWith(data, status)
        return
      }

      const url = data.url ?? ''
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        setShare({ url, copied: false })
        return
      }

      try {
        await navigator.clipboard.writeText(url)
        setShare({ url, copied: true })
      } catch {
        setShare({ url, copied: false })
      }
    } catch (e) {
      setError({ kind: 'server', reason: e.message })
      setTab('result')
    }
  }

  /** Save the current editor SQL under a name derived from the statement. */
  const saveCurrent = async () => {
    const statement = text.trim()
    if (statement === '' || !endpoints?.saved) {
      return
    }

    const { ok, status, data } = await send(endpoints.saved, 'POST', csrfToken, {
      connection: connectionKey,
      sql: statement,
      name: defaultName(statement),
    })
    if (!ok) {
      failWith(data, status)
      return
    }

    setAddedSaved((list) => [data, ...list.filter((q) => q.id !== data.id)])
    setRemovedSaved((list) => list.filter((id) => id !== data.id))
    setTab('saved')
  }

  const removeSaved = async (id) => {
    const { ok } = await send(`${endpoints.saved}/${id}`, 'DELETE', csrfToken)
    if (ok) {
      setRemovedSaved((list) => (list.includes(id) ? list : [...list, id]))
    }
  }

  const loadAndRun = (raw) => {
    setText(raw)
    execute(raw)
  }

  return (
    <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:bg-[var(--dc-bg)]">
      {/* Toolbar */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-3 tw:py-2">
        <button
          type="button"
          onClick={() => execute(text)}
          disabled={running || !guard.ok}
          className="tw:flex tw:items-center tw:gap-1.5 tw:rounded-md tw:bg-[var(--dc-accent)] tw:px-3 tw:py-1.5 tw:text-xs tw:font-semibold tw:text-[var(--dc-accent-foreground)] tw:hover:opacity-90 tw:disabled:cursor-not-allowed tw:disabled:opacity-40"
          title={t('sql.runHint')}
        >
          <PlayIcon className="tw:h-3.5 tw:w-3.5" />
          {running ? t('sql.running') : t('sql.run')}
        </button>
        {!isEmpty && <GuardChip guard={guard} confirmWrites={confirmWrites} />}

        {/* One segmented cluster: only Run carries a label, since only Run has a
            shortcut and a consequence. The rest live in their tooltips. */}
        <div className="tw:flex tw:items-center tw:overflow-hidden tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)]">
          <ToolbarIcon
            onClick={() => setText((current) => formatSql(current))}
            label={t('sql.format')}
            title={t('sql.formatHint')}
            icon={WandIcon}
          />
          <ToolbarIcon
            onClick={() => {
              setText('')
              setError(null)
              dismissConfirm()
            }}
            label={t('sql.clear')}
            title={t('sql.clearHint')}
            icon={EraserIcon}
          />
          <ToolbarIcon
            onClick={saveCurrent}
            disabled={isEmpty}
            label={t('sql.save')}
            title={t('sql.saveHint')}
            icon={SaveIcon}
          />
          {canExplain && (
            <ToolbarIcon
              onClick={explain}
              disabled={isEmpty || running}
              label={t('sql.explain')}
              title={t('sql.explainHint')}
              icon={TerminalIcon}
            />
          )}
          {canShare && (
            <ToolbarIcon
              onClick={shareCurrent}
              disabled={isEmpty}
              label={t('sql.share')}
              title={t('sql.shareHint')}
              icon={LinkIcon}
            />
          )}
        </div>
      </div>

      {share && <SharePanel share={share} />}

      {/* Editor */}
      <div className="tw:flex tw:min-h-[140px] tw:basis-2/5 tw:flex-col">
        <SqlEditor ref={editorRef} value={text} onChange={setText} onRun={() => execute(text)} />
      </div>

      {/* Lower panel */}
      <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:border-t tw:border-[var(--dc-border)]">
        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-2">
          <Tab active={tab === 'result'} onClick={() => setTab('result')} icon={PlayIcon}>
            {t('sql.tabs.result')}
          </Tab>
          {plan !== null && (
            <Tab active={tab === 'plan'} onClick={() => setTab('plan')} icon={TerminalIcon}>
              {t('sql.tabs.plan')}
            </Tab>
          )}
          <Tab active={tab === 'saved'} onClick={() => setTab('saved')} icon={BookmarkIcon}>
            {t('sql.tabs.saved', { count: saved.length })}
          </Tab>
          <Tab active={tab === 'history'} onClick={() => setTab('history')} icon={ClockIcon}>
            {t('sql.tabs.history', { count: history.length })}
          </Tab>
        </div>

        {confirm && (
          <ConfirmPanel
            statement={confirm.statement}
            word={confirmWord}
            typed={confirmText}
            onType={setConfirmText}
            onCancel={dismissConfirm}
            onConfirm={() => execute(confirm.sql, confirm.token)}
            running={running}
          />
        )}

        <div className="tw:min-h-0 tw:flex-1 tw:overflow-hidden">
          {tab === 'result' && <ResultPanel result={result} error={error} running={running} />}
          {tab === 'plan' && plan !== null && <PlanPanel plan={plan} />}
          {tab === 'saved' && (
            <SavedList items={saved} onPick={(q) => loadAndRun(q.sql)} onRemove={removeSaved} />
          )}
          {tab === 'history' && <HistoryList items={history} onPick={(h) => setText(h.sql)} />}
        </div>
      </div>
    </div>
  )
}

/**
 * One cell of the segmented action group: icon only, the name carried by `title`
 * for the pointer and `aria-label` for everything else. The dividers come from
 * `border-l` on all but the first cell, so the group reads as one control.
 */
function ToolbarIcon({ onClick, disabled, label, title, icon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className="tw:flex tw:h-7 tw:w-8 tw:items-center tw:justify-center tw:border-l tw:border-[var(--dc-border)] tw:text-[var(--dc-text-muted)] tw:first:border-l-0 tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)] tw:disabled:cursor-not-allowed tw:disabled:opacity-40"
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
    </button>
  )
}

/**
 * The guard verdict at a glance: a muted `read` chip, an amber `write` chip on a
 * writable connection, and the rejection reason when the statement can't run.
 */
function GuardChip({ guard, confirmWrites }) {
  const t = useStrings()

  const isWrite = guard.ok && guard.kind === 'write'
  const label = guard.ok
    ? isWrite
      ? t('sql.chip.write')
      : t('sql.chip.read')
    : t('sql.chip.blocked')
  // Icon only: the verdict lives in the tooltip, and a rejection is spelled out in
  // full by the error panel under the editor anyway.
  const title =
    isWrite && confirmWrites ? t('sql.confirmNeeded') : t(guard.messageKey, guard.replacements)
  const Icon = guard.ok && !isWrite ? LockIcon : AlertIcon

  return (
    <span
      title={title}
      aria-label={label}
      className={cx(
        'tw:flex tw:h-7 tw:w-7 tw:items-center tw:justify-center tw:rounded-md tw:border',
        !guard.ok &&
          'tw:border-[color-mix(in_srgb,var(--dc-key)_40%,transparent)] tw:bg-[color-mix(in_srgb,var(--dc-key)_12%,transparent)] tw:text-[var(--dc-key)]',
        isWrite && 'tw:border-amber-500/40 tw:bg-amber-500/10 tw:text-amber-500',
        guard.ok &&
          !isWrite &&
          'tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:text-[var(--dc-text-muted)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
    </span>
  )
}

/**
 * The 409 handshake: the exact statement the server holds a token for, plus a
 * type-to-confirm box. Confirm replays the identical request with `confirm_token`.
 */
function ConfirmPanel({ statement, word, typed, onType, onCancel, onConfirm, running }) {
  const t = useStrings()
  const matches = typed === word

  return (
    <div className="tw:shrink-0 tw:border-b tw:border-amber-500/40 tw:bg-amber-500/10 tw:px-4 tw:py-3">
      <div className="tw:flex tw:items-start tw:gap-2.5">
        <AlertIcon className="tw:mt-0.5 tw:h-4 tw:w-4 tw:shrink-0 tw:text-amber-500" />
        <div className="tw:min-w-0 tw:flex-1">
          <div className="tw:text-sm tw:font-semibold tw:text-[var(--dc-text)]">
            {t('sql.confirm.title')}
          </div>
          <pre className="tw:mt-2 tw:max-h-32 tw:overflow-auto tw:rounded tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-3 tw:py-2 tw:font-mono tw:text-xs tw:whitespace-pre-wrap tw:text-[var(--dc-text)]">
            {statement}
          </pre>
          <div className="tw:mt-2 tw:text-xs tw:text-[var(--dc-text-muted)]">
            {t('sql.confirm.body', { word })}
          </div>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <input
              type="text"
              value={typed}
              onChange={(event) => onType(event.target.value)}
              placeholder={t('sql.confirm.placeholder', { word })}
              className="tw:w-32 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1.5 tw:font-mono tw:text-xs tw:text-[var(--dc-text)] tw:outline-none tw:focus:border-amber-500"
            />
            <button
              type="button"
              onClick={onCancel}
              className="tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2.5 tw:py-1.5 tw:text-xs tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]"
            >
              {t('sql.confirm.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!matches || running}
              className="tw:flex tw:items-center tw:gap-1.5 tw:rounded-md tw:bg-amber-500 tw:px-2.5 tw:py-1.5 tw:text-xs tw:font-semibold tw:text-white tw:hover:opacity-90 tw:disabled:cursor-not-allowed tw:disabled:opacity-40"
            >
              <PlayIcon className="tw:h-3.5 tw:w-3.5" />
              {t('sql.confirm.run')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The share link: a flash confirmation, or the URL itself when there's no clipboard. */
function SharePanel({ share }) {
  const t = useStrings()

  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-3 tw:py-1.5 tw:text-xs tw:text-[var(--dc-text-muted)]">
      {share.copied ? (
        <>
          <CheckIcon className="tw:h-3.5 tw:w-3.5 tw:text-[var(--dc-accent)]" />
          {t('sql.shareCopied')}
        </>
      ) : (
        <>
          <LinkIcon className="tw:h-3.5 tw:w-3.5" />
          {t('sql.shareFallback')}
          <input
            type="text"
            readOnly
            value={share.url}
            onFocus={(event) => event.target.select()}
            className="tw:min-w-0 tw:flex-1 tw:rounded tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1 tw:font-mono tw:text-[11px] tw:text-[var(--dc-text)] tw:outline-none"
          />
        </>
      )}
    </div>
  )
}

function ResultPanel({ result, error, running }) {
  const t = useStrings()

  if (running) {
    return (
      <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:text-sm tw:text-[var(--dc-text-muted)]">
        {t('sql.result.running')}
      </div>
    )
  }

  if (error) {
    const isGuard = error.kind !== 'server'
    return (
      <div className="tw:flex tw:h-full tw:items-start tw:justify-center tw:p-6">
        <div className="tw:flex tw:max-w-lg tw:items-start tw:gap-2.5 tw:rounded-md tw:border tw:border-[color-mix(in_srgb,var(--dc-key)_40%,transparent)] tw:bg-[color-mix(in_srgb,var(--dc-key)_12%,transparent)] tw:px-4 tw:py-3 tw:text-sm tw:text-[var(--dc-text)]">
          <AlertIcon className="tw:mt-0.5 tw:h-4 tw:w-4 tw:shrink-0 tw:text-[var(--dc-key)]" />
          <div>
            <div className="tw:font-semibold">
              {isGuard ? t('guard.title') : t('sql.error.title')}
            </div>
            <div className="tw:mt-0.5 tw:text-[var(--dc-text-muted)]">
              {isGuard ? (
                <>
                  {error.keyword && <span className="tw:font-mono">{error.keyword}</span>} —{' '}
                  {t(error.messageKey, error.replacements)} {t('guard.hint')}
                </>
              ) : (
                <span className="tw:font-mono tw:break-words">{error.reason}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:text-sm tw:text-[var(--dc-text-muted)]">
        {t('sql.result.empty')}
      </div>
    )
  }

  // A write returns no result set — report the row count instead of an empty grid.
  if (result.kind === 'write' || !Array.isArray(result.rows) || !Array.isArray(result.columns)) {
    return (
      <div className="tw:flex tw:h-full tw:items-start tw:justify-center tw:p-6">
        <div className="tw:flex tw:max-w-lg tw:items-start tw:gap-2.5 tw:rounded-md tw:border tw:border-amber-500/40 tw:bg-amber-500/10 tw:px-4 tw:py-3 tw:text-sm tw:text-[var(--dc-text)]">
          <CheckIcon className="tw:mt-0.5 tw:h-4 tw:w-4 tw:shrink-0 tw:text-amber-500" />
          <div>
            <div className="tw:font-semibold">{t('sql.result.writeTitle')}</div>
            <div className="tw:mt-0.5 tw:text-[var(--dc-text-muted)]">
              {t('sql.result.rowsAffected', { count: result.rowsAffected ?? 0 })} ·{' '}
              {t('sql.result.elapsed', { ms: result.elapsedMs ?? 0 })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const subtitle = [
    t('sql.result.columns', { count: result.columns.length }),
    t('sql.result.rows', { count: result.rows.length }),
    t('sql.result.elapsed', { ms: result.elapsedMs }),
    result.truncated ? t('sql.result.truncated') : null,
    result.simulated ? t('sql.result.simulated') : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <DataGrid
      table={{
        name: 'result',
        type: 'result',
        rowCount: result.rows.length,
        columns: result.columns,
        rows: result.rows,
      }}
      title={t('sql.result.title')}
      subtitle={subtitle}
      csvName="query-result.csv"
    />
  )
}

/** The EXPLAIN output: server-formatted lines, rendered verbatim. */
function PlanPanel({ plan }) {
  const t = useStrings()

  return (
    <div className="tw:h-full tw:overflow-auto tw:px-4 tw:py-3">
      <div className="tw:mb-2 tw:text-xs tw:font-semibold tw:text-[var(--dc-text-muted)]">
        {t('sql.plan.title')}
      </div>
      <pre className="tw:font-mono tw:text-xs tw:whitespace-pre tw:text-[var(--dc-text)]">
        {plan.join('\n')}
      </pre>
    </div>
  )
}

function SavedList({ items, onPick, onRemove }) {
  const t = useStrings()

  if (items.length === 0) {
    return (
      <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:text-sm tw:text-[var(--dc-text-muted)]">
        {t('sql.saved.empty')}
      </div>
    )
  }
  return (
    <ul className="tw:h-full tw:divide-y tw:divide-[var(--dc-border)] tw:overflow-auto">
      {items.map((q) => (
        <li key={q.id} className="tw:group tw:relative tw:flex tw:items-stretch">
          <button
            type="button"
            onClick={() => onPick(q)}
            className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-1 tw:px-4 tw:py-2.5 tw:pr-10 tw:text-left tw:hover:bg-[var(--dc-hover)]"
          >
            <span className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-medium tw:text-[var(--dc-text)]">
              <BookmarkIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-table-icon)]" />
              {q.name}
            </span>
            <span className="tw:truncate tw:font-mono tw:text-xs tw:text-[var(--dc-text-muted)]">
              {oneLine(q.sql)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onRemove(q.id)}
            title={t('sql.saved.remove')}
            aria-label={t('sql.saved.removeLabel', { name: q.name })}
            className="tw:absolute tw:top-1/2 tw:right-2 tw:-translate-y-1/2 tw:rounded tw:p-1.5 tw:text-[var(--dc-text-faint)] tw:opacity-0 tw:group-hover:opacity-100 tw:hover:bg-[color-mix(in_srgb,var(--dc-key)_14%,transparent)] tw:hover:text-[var(--dc-key)] tw:focus:opacity-100"
          >
            <TrashIcon className="tw:h-3.5 tw:w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Display-only: the server records every run, this just replays one into the editor. */
function HistoryList({ items, onPick }) {
  const t = useStrings()

  if (items.length === 0) {
    return (
      <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:text-sm tw:text-[var(--dc-text-muted)]">
        {t('sql.history.empty')}
      </div>
    )
  }
  return (
    <ul className="tw:h-full tw:divide-y tw:divide-[var(--dc-border)] tw:overflow-auto">
      {items.map((h, i) => (
        <li key={h.id ?? i}>
          <button
            type="button"
            onClick={() => onPick(h)}
            className="tw:flex tw:w-full tw:items-center tw:gap-3 tw:px-4 tw:py-2 tw:text-left tw:hover:bg-[var(--dc-hover)]"
          >
            <ClockIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:font-mono tw:text-xs tw:text-[var(--dc-text)]">
              {oneLine(h.sql)}
            </span>
            {h.status && h.status !== 'ok' && (
              <span className="tw:shrink-0 tw:rounded tw:border tw:border-amber-500/40 tw:bg-amber-500/10 tw:px-1.5 tw:py-0.5 tw:text-[10px] tw:text-amber-500">
                {t('sql.history.failed')}
              </span>
            )}
            <span className="tw:shrink-0 tw:text-[11px] tw:text-[var(--dc-text-faint)]">
              {t('sql.history.meta', {
                rows: h.rows ?? '–',
                ms: h.elapsedMs ?? 0,
                at: timeLabel(h.at),
              })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Tab({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'tw:flex tw:items-center tw:gap-1.5 tw:border-b-2 tw:px-3 tw:py-2 tw:text-xs tw:font-medium',
        active
          ? 'tw:border-[var(--dc-accent)] tw:text-[var(--dc-accent)]'
          : 'tw:border-transparent tw:text-[var(--dc-text-muted)] tw:hover:text-[var(--dc-text)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
      {children}
    </button>
  )
}

/** Collapse a multi-line query to one line for compact list rendering. */
function oneLine(sql) {
  return String(sql ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Render the server's ISO timestamp as a local clock time. */
function timeLabel(at) {
  if (!at) {
    return ''
  }
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? String(at) : date.toLocaleTimeString('en-GB')
}

/** Derive a display name from the SQL (first line, truncated) when none is given. */
function defaultName(sql) {
  const line = oneLine(sql)
  return line.length > 48 ? `${line.slice(0, 48)}…` : line
}

/**
 * The run just made, shaped like a server history row so the tab updates without a
 * reload. The server has already recorded the authoritative row.
 */
function historyEntry(sql, result, connectionKey) {
  return {
    id: `local_${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    sql,
    connection: connectionKey ?? '',
    rows: Array.isArray(result?.rows) ? result.rows.length : (result?.rowsAffected ?? null),
    elapsedMs: result?.elapsedMs ?? 0,
    status: 'ok',
    at: new Date().toISOString(),
  }
}

/**
 * Identity of one run, used to drop an optimistic entry once the server's own row
 * for the same run arrives in a fresh payload.
 */
function runKey(entry) {
  return `${entry.sql}|${entry.rows}|${entry.elapsedMs}`
}

/**
 * One JSON request to a console endpoint. Never throws on a non-2xx — the caller
 * branches on `status` (409 is the confirmation handshake, 422 a guard / DB
 * rejection carrying a localised `message`).
 *
 * @returns {Promise<{ok: boolean, status: number, data: Record<string, any>}>}
 */
async function send(url, method, csrfToken, body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': csrfToken ?? '',
      'X-Requested-With': 'XMLHttpRequest',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const data = await response.json().catch(() => ({}))

  return { ok: response.ok, status: response.status, data }
}
