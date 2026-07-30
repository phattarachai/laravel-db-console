<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The suite's own schema — deliberately neutral nouns, so the package never
 * learns anything about the app it was extracted from.
 *
 *   dc_users   an authenticatable, plus a `password` to prove column masking
 *   dc_owners  the parent: a plain table with a maskable `secret_token`
 *   dc_items   the child: proves FK introspection and `on delete cascade`
 *   dc_hidden  exists only to be excluded by `hidden_tables`
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
            $table->timestamps();
        });

        Schema::create('dc_hidden', function (Blueprint $table): void {
            $table->id();
            $table->string('note');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dc_hidden');
        Schema::dropIfExists('dc_items');
        Schema::dropIfExists('dc_owners');
        Schema::dropIfExists('dc_users');
    }
};
