import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'

import { tokenizeSql } from './sql-lib'
import { useStrings } from './strings'

/**
 * Zero-dependency SQL editor: a syntax-highlighted <pre> sits behind a
 * transparent <textarea>, with a scroll-synced line-number gutter. Kept behind a
 * minimal `value` / `onChange` / `onRun` contract so it can be swapped for a
 * heavier editor (CodeMirror / Monaco) later without touching SqlConsole.
 *
 * Exposes an imperative `insertText(token)` (via ref) that drops an identifier at
 * the cursor — used by the sidebar's double-click-to-insert.
 *
 * Keys: Cmd/Ctrl+Enter runs, Tab inserts two spaces.
 *
 * @param {{value: string, onChange: (v: string) => void, onRun: () => void}} props
 */
export const SqlEditor = forwardRef(function SqlEditor({ value, onChange, onRun }, ref) {
  const t = useStrings()
  const inputRef = useRef(null)
  const highlightRef = useRef(null)
  const gutterRef = useRef(null)

  // Insert `token` at the caret (or replace the selection), adding a leading
  // space when needed so identifiers don't collide with preceding text.
  useImperativeHandle(
    ref,
    () => ({
      insertText(token) {
        const el = inputRef.current
        const start = el?.selectionStart ?? value.length
        const end = el?.selectionEnd ?? value.length
        const before = value.slice(0, start)
        const after = value.slice(end)
        const glue = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
        const next = `${before}${glue}${token}${after}`
        onChange(next)
        const caret = before.length + glue.length + token.length
        requestAnimationFrame(() => {
          if (!el) {
            return
          }
          el.focus()
          el.selectionStart = el.selectionEnd = caret
        })
      },
    }),
    [value, onChange],
  )

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const tokens = useMemo(() => tokenizeSql(value), [value])

  // Keep the highlight layer and gutter aligned with the textarea's scroll.
  const syncScroll = () => {
    const el = inputRef.current
    if (!el) {
      return
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = el.scrollTop
      highlightRef.current.scrollLeft = el.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = el.scrollTop
    }
  }
  useLayoutEffect(syncScroll, [value])

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onRun()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.target
      const { selectionStart: s, selectionEnd: end } = el
      const next = `${value.slice(0, s)}  ${value.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2
      })
    }
  }

  return (
    <div className="dc-sql-editor">
      <div
        ref={gutterRef}
        aria-hidden
        className="dc-editor-layer dc-sql-gutter"
        style={{ paddingLeft: 10, paddingRight: 10 }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      <div className="dc-sql-body">
        <pre
          ref={highlightRef}
          aria-hidden
          className="dc-editor-layer dc-editor-highlight dc-sql-layer"
        >
          {tokens.map((tok, i) => {
            const cls =
              tok.type === 'keyword'
                ? 'dc-tok-keyword'
                : tok.type === 'string'
                  ? 'dc-tok-string'
                  : tok.type === 'number'
                    ? 'dc-tok-number'
                    : tok.type === 'comment'
                      ? 'dc-tok-comment'
                      : undefined
            return cls ? (
              <span key={i} className={cls}>
                {tok.value}
              </span>
            ) : (
              tok.value
            )
          })}
          {'\n'}
        </pre>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="dc-editor-layer dc-editor-input dc-sql-input"
          placeholder={t('sql.editorPlaceholder')}
        />
      </div>
    </div>
  )
})
