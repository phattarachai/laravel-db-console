/**
 * Types for the `@db-console` Vite alias, published next to the TypeScript
 * page so `tsc` can resolve the module. The module itself ships as JSX.
 */
declare module '@db-console' {
    import type { ComponentType } from 'react';

    export interface DbConsoleConnection {
        key: string;
        name?: string;
        label?: string;
        database?: string;
        driver?: string;
        dialect?: 'pgsql' | 'mysql' | 'mariadb';
        mode?: 'read' | 'write';
        confirmWrites?: boolean;
        error?: string;
    }

    export interface DbConsoleProps {
        connections?: DbConsoleConnection[];
        connection?: DbConsoleConnection | null;
        schemas?: Array<{
            name: string;
            tables: Array<{ name: string; type: string; rowCount: number }>;
        }>;
        favorites?: string[];
        sql?: { defaultQuery: string; saved: unknown[]; history: unknown[] };
        endpoints?: Record<string, string>;
        brand?: {
            name?: string;
            url?: string;
            accent?: string;
            scheme?: 'light' | 'dark' | 'auto';
            logo?: string;
        };
        features?: { explain: boolean; share: boolean; rowEdit: boolean };
        shared?: { expired: boolean; sql: string | null };
        fatal?: string | null;
        strings?: Record<string, string>;
        csrfToken?: string;
    }

    export const DbConsole: ComponentType<DbConsoleProps>;
}
