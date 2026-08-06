<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Eloquent\Builder;

/**
 * Owner scoping for everything the console keeps on the viewer's behalf — saved
 * queries, history, share links, favourites.
 *
 * The owner is the authenticated user when the host app has auth, and the
 * session otherwise, so the console works unchanged in an app with no auth at
 * all. Exactly one of the two columns is ever set, which is what keeps the
 * prune command's owner buckets disjoint.
 */
trait ScopesToOwner
{
    /**
     * The single place the user/session branch is expressed for reads.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @return Builder<TModel>
     */
    private function scopeToOwner(Builder $query): Builder
    {
        $owner = $this->ownerAttributes();

        if ($owner['user_id'] !== null) {
            return $query->where('user_id', $owner['user_id']);
        }

        if ($owner['session_id'] === null) {
            return $query->whereNull('user_id')->whereNull('session_id');
        }

        return $query->whereNull('user_id')->where('session_id', $owner['session_id']);
    }

    /**
     * The same branch for writes.
     *
     * @return array{user_id:int|null,session_id:string|null}
     */
    private function ownerAttributes(): array
    {
        $userId = $this->ownerUserId();

        if ($userId !== null) {
            return ['user_id' => $userId, 'session_id' => null];
        }

        return ['user_id' => null, 'session_id' => $this->ownerSessionId()];
    }

    /**
     * Non-numeric keys (a UUID-keyed user table) fall through to session
     * scoping rather than being coerced into the integer column.
     */
    private function ownerUserId(): ?int
    {
        $id = auth()->hasUser() ? auth()->id() : null;

        return is_numeric($id) ? (int) $id : null;
    }

    private function ownerSessionId(): ?string
    {
        $id = session()->getId();

        return $id === '' ? null : $id;
    }
}
