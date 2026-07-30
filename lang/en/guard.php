<?php

declare(strict_types=1);

return [

    'empty' => 'No statement to run.',
    'single_statement' => 'Only one statement at a time.',
    'must_start' => 'A statement must start with SELECT.',
    'blocked' => ':keyword is blocked — never allowed on any connection.',
    'read_only' => ':keyword needs a writable connection; this one is read-only.',
    'unsupported' => ':keyword is not supported.',
    'failed' => 'The statement could not be run.',

    'hidden_table' => 'The table :table is hidden.',

    'read_only_row' => 'This connection is read-only, so rows cannot be edited.',
    'no_primary_key' => 'This table has no primary key, so rows cannot be edited.',
    'pk_mismatch' => 'The primary key given does not match this table.',
    'unknown_column' => 'Unknown column :column.',
    'masked_column' => 'The column :column is masked, so it cannot be written.',
    'affected_not_one' => 'Expected exactly 1 row to change, but :count matched — rolled back.',

    'share_disabled' => 'Sharing is disabled.',

    'confirm_required' => 'Confirm before running this statement.',
    'confirm_invalid' => 'The confirmation has expired or no longer matches the statement. Confirm again.',

];
