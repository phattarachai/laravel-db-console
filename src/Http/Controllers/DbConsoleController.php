<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Inertia\Inertia;
use Inertia\Response;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Exceptions\UnsupportedDriverException;
use Phattarachai\DbConsole\Support\ConfirmToken;
use Phattarachai\DbConsole\Support\Connection;
use Phattarachai\DbConsole\Support\QueryStore;
use Phattarachai\DbConsole\Support\RowWriter;
use Phattarachai\DbConsole\Support\SchemaInspector;
use Phattarachai\DbConsole\Support\SqlRunner;

/**
 * The whole console. Serves live Postgres introspection, runs guarded SQL, edits
 * single rows, and owns the saved/history/share endpoints.
 *
 * Endpoint URLs are handed to the page as props rather than resolved in JS, so
 * the module carries no Laravel coupling and the host needs no generated route
 * helpers.
 */
final class DbConsoleController extends Controller
{
    public function __construct(
        private readonly QueryStore $store,
        private readonly ConfirmToken $confirm,
    ) {}

    public function index(Request $request): Response
    {
        return Inertia::render('DbConsole', $this->payload($request->query('conn')));
    }

    public function shared(Request $request, string $token): Response
    {
        $share = $this->store->resolveShare($token);

        return Inertia::render('DbConsole', [
            ...$this->payload($share['connection'] ?? $request->query('conn')),
            'shared' => $share === null
                ? ['expired' => true, 'sql' => null]
                : ['expired' => false, 'sql' => $share['sql']],
        ]);
    }

    /**
     * Run one statement. A write on a `confirm_writes` connection answers 409
     * with a single-use token first; the same POST replayed with the token runs.
     */
    public function query(Request $request): JsonResponse
    {
        $sql = (string) $request->input('sql', '');

        try {
            $connection = $this->connection($request);
            $runner = new SqlRunner($connection);

            if ($this->needsConfirmation($connection, $sql)) {
                return $this->confirmationRequired($connection, $sql);
            }

            $result = $runner->run($sql);

            $rows = isset($result['rows'])
                ? count($result['rows'])
                : ($result['rowsAffected'] ?? null);

            $this->store->record($connection->key, $sql, $rows, (int) $result['elapsedMs'], 'ok');

            return response()->json($result);
        } catch (SqlGuardException $exception) {
            $this->store->record((string) $request->input('connection', 'default'), $sql, rows: null, elapsedMs: 0, status: 'rejected');

            return response()->json(['message' => $exception->getMessage()], 422);
        } catch (UnsupportedDriverException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function explain(Request $request): JsonResponse
    {
        abort_unless((bool) config('db-console.explain', default: true), 404);

        try {
            return response()->json(new SqlRunner($this->connection($request))->explain((string) $request->input('sql', '')));
        } catch (SqlGuardException|UnsupportedDriverException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    /**
     * Create, update, or delete exactly one row, behind the same confirmation
     * handshake as a written statement. A delete always confirms, whatever
     * `confirm_writes` says: it is irreversible and a single click away.
     */
    public function row(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'schema' => ['nullable', 'string'],
            'table' => ['required', 'string'],
            'action' => ['required', 'in:create,update,delete'],
            'pk' => ['array'],
            'values' => ['array'],
        ]);

        try {
            $connection = $this->connection($request);
            $writer = new RowWriter($connection, new SchemaInspector($connection));

            $schema = (string) ($validated['schema'] ?? $connection->schemas[0] ?? 'public');
            $pk = (array) ($validated['pk'] ?? []);
            $values = (array) ($validated['values'] ?? []);

            $preview = $writer->preview($schema, $validated['table'], $validated['action'], $pk, $values);

            $needsConfirmation = $connection->confirmWrites || $validated['action'] === 'delete';

            if ($needsConfirmation && ! $this->confirm->consume($request->input('confirm_token'), $connection->key, $preview)) {
                return response()->json([
                    'confirm' => [
                        'token' => $this->confirm->issue($connection->key, $preview),
                        'statement' => $preview,
                    ],
                ], 409);
            }

            $result = $writer->apply($schema, $validated['table'], $validated['action'], $pk, $values);

            $this->store->record($connection->key, $result['sql'], $result['affected'], 0, 'ok');

            return response()->json($result);
        } catch (SqlGuardException|UnsupportedDriverException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function share(Request $request): JsonResponse
    {
        try {
            $connection = $this->connection($request);
            $token = $this->store->share($connection->key, (string) $request->input('sql', ''));

            return response()->json(['url' => route('db-console.shared', $token)]);
        } catch (SqlGuardException|UnsupportedDriverException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function storeSaved(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'sql' => ['required', 'string'],
            'name' => ['required', 'string', 'max:255'],
        ]);

        return response()->json($this->store->save(
            (string) $request->input('connection', 'default'),
            $validated['sql'],
            $validated['name'],
        ));
    }

    public function destroySaved(int $saved): JsonResponse
    {
        return response()->json(['deleted' => $this->store->forget($saved)]);
    }

    /**
     * The Inertia payload. Introspection failures for one connection render in
     * place of the tree instead of breaking the page.
     *
     * @return array<string, mixed>
     */
    private function payload(?string $key): array
    {
        $connections = $this->connectionPayloads();
        $active = $this->resolveActive($key, $connections);

        $base = [
            'connections' => $connections,
            'connection' => $active['payload'],
            'endpoints' => [
                'query' => route('db-console.query'),
                'explain' => route('db-console.explain'),
                'row' => route('db-console.row'),
                'share' => route('db-console.share'),
                'saved' => route('db-console.saved.store'),
                'index' => route('db-console.index'),
            ],
            'brand' => config('db-console.brand'),
            'strings' => trans('db-console::ui'),
            'features' => [
                'explain' => (bool) config('db-console.explain', default: true),
                'share' => (bool) config('db-console.share.enabled', default: true),
                'rowEdit' => $active['connection']?->isWritable() ?? false,
            ],
            'sql' => [
                'defaultQuery' => '',
                'saved' => $this->store->saved(),
                'history' => $this->store->history(),
            ],
        ];

        if ($active['connection'] === null) {
            return [...$base, 'schemas' => [], 'fatal' => $active['error']];
        }

        try {
            return [...$base, 'schemas' => new SchemaInspector($active['connection'])->schemas()];
        } catch (UnsupportedDriverException $exception) {
            return [...$base, 'schemas' => [], 'fatal' => $exception->getMessage()];
        }
    }

    /**
     * @return list<array{key: string, name: string, label: string, database: string, driver: string, mode: string, confirmWrites: bool}|array{key: string, label: string, error: string}>
     */
    private function connectionPayloads(): array
    {
        $payloads = [];

        foreach (array_keys((array) config('db-console.connections', ['default' => []])) as $key) {
            try {
                $payloads[] = Connection::resolve((string) $key)->payload();
            } catch (UnsupportedDriverException $exception) {
                $payloads[] = ['key' => (string) $key, 'label' => (string) $key, 'error' => $exception->getMessage()];
            }
        }

        return $payloads;
    }

    /**
     * @param  list<array<string, mixed>>  $payloads
     * @return array{connection: Connection|null, payload: array<string, mixed>|null, error: string|null}
     */
    private function resolveActive(?string $key, array $payloads): array
    {
        try {
            $connection = Connection::resolve($key !== null && $key !== '' ? $key : null);

            return ['connection' => $connection, 'payload' => $connection->payload(), 'error' => null];
        } catch (UnsupportedDriverException $exception) {
            return [
                'connection' => null,
                'payload' => $payloads[0] ?? null,
                'error' => $exception->getMessage(),
            ];
        }
    }

    private function connection(Request $request): Connection
    {
        $key = $request->input('connection');

        return Connection::resolve(is_string($key) && $key !== '' ? $key : null);
    }

    private function needsConfirmation(Connection $connection, string $sql): bool
    {
        if (! $connection->confirmWrites || ! $connection->isWritable()) {
            return false;
        }

        return new SqlRunner($connection)->kind($sql) === 'write'
            && ! $this->confirm->consume(request()->input('confirm_token'), $connection->key, $sql);
    }

    private function confirmationRequired(Connection $connection, string $sql): JsonResponse
    {
        return response()->json([
            'confirm' => [
                'token' => $this->confirm->issue($connection->key, $sql),
                'statement' => $sql,
            ],
        ], 409);
    }
}
