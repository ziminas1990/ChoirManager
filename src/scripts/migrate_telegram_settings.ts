import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { GoogleAuth } from "@src/api/google_auth.js";
import { TelegramSettingsStorageFactory } from "@src/adapters/telegram_settings_storage/factory.js";
import { RuntimeSnapshotTelegramSettingsSource } from "@src/adapters/telegram_settings_storage/runtime_snapshot.js";
import type { BotConfigJson } from "@src/config.js";
import { KeyValueStorageError } from "@src/interfaces/storage/key_value_storage.js";
import { ITelegramSettingsStorage } from "@src/interfaces/storage/telegram_settings_storage.js";
import { Expected } from "@src/utils/expected.js";

type MigrationResult = "created" | "already_exists" | "no_settings";

async function migrate(
    source: Pick<ITelegramSettingsStorage, "get">,
    destination: ITelegramSettingsStorage,
): Promise<Expected<MigrationResult>> {
    const existing = await destination.get();
    if (!existing.ok) {
        return existing.wrap_error("Failed to read destination settings");
    }
    if (existing.value !== undefined) {
        return Expected.ok("already_exists");
    }

    const settings = await source.get();
    if (!settings.ok) {
        return settings.cast_error();
    }
    if (settings.value === undefined || Object.values(settings.value).every(value => value === undefined)) {
        return Expected.ok("no_settings");
    }

    const created = await destination.create(settings.value);
    if (created.ok) {
        return Expected.ok("created");
    }
    if (created.is_error(KeyValueStorageError.AlreadyExists)) {
        // Another migration may have created the document after our initial read.
        const concurrent = await destination.get();
        if (!concurrent.ok) {
            return concurrent.wrap_error("Failed to read concurrently created settings");
        }
        if (concurrent.value !== undefined) {
            return Expected.ok("already_exists");
        }
    }
    return created.wrap_error("Failed to create destination settings");
}

async function main(): Promise<Expected<MigrationResult>> {
    const { values } = parseArgs({
        options: {
            config: { type: "string" },
            snapshot: { type: "string" },
        },
    });
    if (!values.config) {
        return Expected.err("Usage: npm run migrate:telegram-settings -- --config <botcfg.json> [--snapshot <runtime.json>]");
    }

    // Read only migration configuration; do not initialize the bot or unrelated services.
    const config = JSON.parse(await readFile(values.config, "utf8")) as Partial<BotConfigJson>;
    const settings_config = config.tg_adapter?.settings_storage;
    if (!settings_config) {
        return Expected.err("'tg_adapter.settings_storage' MUST be specified");
    }
    const verified = TelegramSettingsStorageFactory.verify(settings_config);
    if (!verified.ok) {
        return verified.wrap_error("Invalid settings storage configuration");
    }
    if (settings_config.storage.database_id !== "ursa-major-db-test") {
        return Expected.err("Migration is restricted to database 'ursa-major-db-test'");
    }
    if (typeof config.google_cloud_key_file !== "string" || !config.google_cloud_key_file.trim()) {
        return Expected.err("'google_cloud_key_file' MUST be specified");
    }
    const snapshot = values.snapshot ?? config.runtime_cache_filename;
    if (typeof snapshot !== "string" || !snapshot.trim()) {
        return Expected.err("Specify '--snapshot' or 'runtime_cache_filename' in configuration");
    }

    const authenticated = await GoogleAuth.authenticate(config.google_cloud_key_file);
    if (!authenticated.ok) {
        return authenticated.cast_error();
    }
    const destination = TelegramSettingsStorageFactory.create(settings_config);
    if (!destination.ok) {
        return destination.cast_error();
    }
    return migrate(new RuntimeSnapshotTelegramSettingsSource(snapshot), destination.value);
}

try {
    const result = await main();
    if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
    } else {
        const messages: Record<MigrationResult, string> = {
            created: "Telegram settings migrated successfully.",
            already_exists: "Destination settings already exist; nothing was overwritten.",
            no_settings: "Snapshot contains no Telegram settings; nothing was created.",
        };
        console.log(messages[result.value]);
    }
} catch (error) {
    console.error(Expected.exception("Telegram settings migration failed", error).error);
    process.exitCode = 1;
}
