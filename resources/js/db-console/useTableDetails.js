import { useCallback, useRef, useState } from 'react'

import { sendJson, withQuery } from './lib'

/** Cache key for one object — schema-qualified, since two schemas may share a name. */
export function detailKey(schema, table) {
  return `${schema ?? ''}.${table}`
}

/**
 * Lazily loaded table detail: columns, indexes, foreign keys and the row sample.
 *
 * The page payload carries only the tree (name, kind, row count), because
 * building the full detail for every object is six queries and a few hundred KB
 * each — on a 150-table database that is the difference between opening the
 * console in ~800 queries and in a handful. This fetches one object at a time,
 * when it is selected or expanded, and never fetches the same one twice.
 *
 * @param {{endpoint?: string, csrfToken?: string, connectionKey?: string}} options
 */
export function useTableDetails({ endpoint, csrfToken, connectionKey }) {
  const [details, setDetails] = useState({})
  const [errors, setErrors] = useState({})
  // Refs, not state: these gate the fetch itself, and putting them in state
  // would rebuild `load` on every resolution and re-fire the effects that call it.
  const settled = useRef(new Set())
  const inFlight = useRef(new Set())

  const load = useCallback(
    async (schema, table) => {
      const id = detailKey(schema, table)

      if (!endpoint || !table || settled.current.has(id) || inFlight.current.has(id)) {
        return
      }

      inFlight.current.add(id)

      const url = withQuery(endpoint, { connection: connectionKey, schema, table })
      const { ok, data } = await sendJson(url, 'GET', csrfToken)

      inFlight.current.delete(id)
      settled.current.add(id)

      if (ok) {
        setDetails((current) => ({ ...current, [id]: data }))
      } else {
        setErrors((current) => ({ ...current, [id]: data?.message ?? '' }))
      }
    },
    [endpoint, csrfToken, connectionKey],
  )

  const get = useCallback((schema, table) => details[detailKey(schema, table)] ?? null, [details])
  const errorFor = useCallback((schema, table) => errors[detailKey(schema, table)] ?? null, [errors])

  return { get, errorFor, load }
}
