import { Head } from '@inertiajs/react';

import { DbConsole } from '@db-console';
import type { DbConsoleProps } from '@db-console';

/**
 * The only page the DB Console package publishes into the host app —
 * the page resolver never leaves ./pages, so the page must live here while the
 * module itself is reached through the `@db-console` Vite alias. Its types come
 * from `resources/js/types/db-console.d.ts`, published alongside.
 *
 * Everything Laravel-shaped stops at this file: endpoint URLs arrive as props
 * (no route helpers), and the CSRF token is read from the meta tag. The module
 * below stays portable.
 */
export default function DbConsolePage(props: DbConsoleProps) {
    // Under Inertia SSR there is no `document`; the module renders client-side
    // only, so the token is read again in the browser before any request is made.
    const csrfToken =
        typeof document === 'undefined'
            ? ''
            : (document
                  .querySelector('meta[name=csrf-token]')
                  ?.getAttribute('content') ?? '');

    return (
        <>
            <Head
                title={
                    props.brand?.name
                        ? `${props.brand.name} · DB Console`
                        : 'DB Console'
                }
            />
            <DbConsole {...props} csrfToken={csrfToken} />
        </>
    );
}

// The console is a full-screen app. An empty layout list opts out of the
// default layout `createInertiaApp({ layout })` applies — a page's own layout
// always wins over the default.
DbConsolePage.layout = [] as unknown[];
