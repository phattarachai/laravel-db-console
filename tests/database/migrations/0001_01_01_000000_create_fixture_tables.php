<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The suite's own schema — deliberately neutral nouns, so the package never
 * learns anything about the app it was extracted from.
 *
 *   dc_users   an authenticatable, plus a `password` to prove column masking
 *   dc_owners  the parent: a plain table with a maskable `secret_token`
 *   dc_items   the child: proves FK introspection and `on delete cascade`, and
 *              carries a binary column that must never reach JSON raw
 *   dc_hidden  exists only to be excluded by `hidden_tables`
 *
 * On MySQL it also creates `dc_write_probe()`, a function that inserts a row,
 * so the suite can prove the READ ONLY transaction stops a write the keyword
 * guard lets through.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dc_users', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
        });

        Schema::create('dc_owners', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('secret_token')->nullable();
            $table->timestamps();
        });

        Schema::create('dc_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('owner_id')->nullable()->constrained('dc_owners')->cascadeOnDelete();
            $table->string('name');
            $table->binary('fingerprint')->nullable();
            $table->timestamps();
        });

        Schema::create('dc_hidden', function (Blueprint $table): void {
            $table->id();
            $table->string('note');
        });

        if (DB::getDriverName() !== 'pgsql') {
            // DETERMINISTIC is not true, but with binary logging on MySQL only
            // lets a function be created without SUPER if it claims to be.
            DB::unprepared('DROP FUNCTION IF EXISTS dc_write_probe');
            DB::unprepared("CREATE FUNCTION dc_write_probe() RETURNS INT DETERMINISTIC MODIFIES SQL DATA
                BEGIN
                    INSERT INTO dc_owners (name, created_at, updated_at) VALUES ('probe', NOW(), NOW());
                    RETURN 1;
                END");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            DB::unprepared('DROP FUNCTION IF EXISTS dc_write_probe');
        }

        Schema::dropIfExists('dc_hidden');
        Schema::dropIfExists('dc_items');
        Schema::dropIfExists('dc_owners');
        Schema::dropIfExists('dc_users');
    }
};
