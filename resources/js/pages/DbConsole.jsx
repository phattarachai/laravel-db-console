import { Head } from '@inertiajs/react'

import { DbConsole } from '@db-console'

/**
 * The only file the DB Console package publishes into the host app —
 * `app.jsx`'s page glob never leaves ./pages, so the page must live here while
 * the module itself is reached through the `@db-console` Vite alias.
 *
 * Everything Laravel-shaped stops at this file: endpoint URLs arrive as props
 * (no route helpers), and the CSRF token is read from the meta tag. The module
 * below stays portable.
 */
export default function DbConsolePage(props) {
  // Under Inertia SSR there is no `document`; the module renders client-side
  // only, so the token is read again in the browser before any request is made.
  const csrfToken =
    typeof document === 'undefined'
      ? ''
      : (document.querySelector('meta[name=csrf-token]')?.getAttribute('content') ?? '')

  return (
    <>
      <Head title={props.brand?.name ? `${props.brand.name} · DB Console` : 'DB Console'} />
      <DbConsole {...props} csrfToken={csrfToken} />
    </>
  )
}

// The console is a full-screen app. An empty layout list opts out of any
// default layout the host's `createInertiaApp({ layout })` applies — a page's
// own layout always wins over the default.
DbConsolePage.layout = []
