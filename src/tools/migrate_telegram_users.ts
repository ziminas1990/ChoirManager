import fs from "node:fs";
import path from "node:path";

import { GoogleAuth } from "@src/api/google_auth.js";
import { PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { UserServiceFactory } from "@src/adapters/user_service/factory.js";
import { telegram_user_firestore_converter } from "@src/adapters/telegram/telegram_user_mapper.js";
import {
    TelegramUserRecord,
    telegram_user_record_id,
} from "@src/adapters/telegram/telegram_user_record.js";
import { load_config } from "@src/config.js";
import { IUserService } from "@src/interfaces/user_service.js";
import { IPlainCollection } from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

type PackedTelegramUser = {
    tgid: string;
    chat_id?: number;
};

type UpsertOutcome = "created" | "updated" | "unchanged";

function dry_run_from_argv(argv: string[]): boolean {
    return !argv.includes("--apply");
}

function load_packed_telegram_users(runtime_path: string): unknown[] {
    const raw = fs.readFileSync(runtime_path, "utf8");
    const packed = JSON.parse(raw) as {
        tg_adapter?: {
            users?: unknown;
        };
    };
    const users = packed.tg_adapter?.users;
    if (users == undefined) {
        return [];
    }
    if (!Array.isArray(users)) {
        throw new Error("runtime.tg_adapter.users is not an array");
    }
    return users;
}

function is_complete_packed_user(
    packed: unknown,
): packed is PackedTelegramUser & { tgid: string; chat_id: number } {
    if (packed == undefined || typeof packed !== "object") {
        return false;
    }
    const record = packed as PackedTelegramUser;
    return typeof record.tgid === "string"
        && record.tgid.length > 0
        && typeof record.chat_id === "number";
}

async function upsert_record(
    collection: IPlainCollection<TelegramUserRecord>,
    telegram_id: number,
    record: Omit<TelegramUserRecord, "id" | "revision">,
    dry_run: boolean,
): Promise<Expected<UpsertOutcome>> {
    const id = telegram_user_record_id(telegram_id);
    const existing = await collection.get_one(id);

    if (existing.ok) {
        if (existing.value.user_id === record.user_id
            && existing.value.telegram_username === record.telegram_username
            && existing.value.private_chat_id === record.private_chat_id) {
            return Expected.ok("unchanged");
        }
        if (dry_run) {
            return Expected.ok("updated");
        }
        const updated = await collection.update({
            id,
            user_id: record.user_id,
            telegram_username: record.telegram_username,
            private_chat_id: record.private_chat_id,
        });
        if (!updated.ok) {
            return updated.cast_error();
        }
        return Expected.ok("updated");
    }

    if (!existing.error.includes("not found")) {
        return existing.cast_error();
    }

    if (dry_run) {
        return Expected.ok("created");
    }

    const created = await collection.create({
        id,
        revision: 1,
        ...record,
    });
    if (!created.ok) {
        return created.cast_error();
    }
    return Expected.ok("created");
}

async function migrate(
    user_service: IUserService,
    collection: IPlainCollection<TelegramUserRecord>,
    packed_users: unknown[],
    dry_run: boolean,
): Promise<Status> {
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const packed of packed_users) {
        if (!is_complete_packed_user(packed)) {
            skipped++;
            console.error(`[SKIP] ${JSON.stringify(packed)}: tgid or chat_id is missing`);
            continue;
        }

        const telegram_username = packed.tgid;
        const telegram_id = packed.chat_id;

        const resolved = await user_service.resolve_user({
            tg_username: telegram_username,
        });
        if (!resolved.ok) {
            skipped++;
            console.error(
                `[SKIP] @${telegram_username} telegram_id=${telegram_id}: ${resolved.error}`);
            continue;
        }
        if (!resolved.value) {
            skipped++;
            console.error(
                `[SKIP] @${telegram_username} telegram_id=${telegram_id}: user not found`);
            continue;
        }

        const record = {
            user_id: resolved.value.id.system_id,
            telegram_username,
            private_chat_id: telegram_id,
        };
        const outcome = await upsert_record(collection, telegram_id, record, dry_run);
        if (!outcome.ok) {
            skipped++;
            console.error(
                `[SKIP] @${telegram_username} telegram_id=${telegram_id}: ${outcome.error}`);
            continue;
        }

        const prefix = dry_run ? "[DRY RUN] " : "";
        switch (outcome.value) {
            case "created":
                created++;
                console.log(
                    `${prefix}[CREATE] @${telegram_username} telegram_id=${telegram_id} user_id=${record.user_id}`);
                break;
            case "updated":
                updated++;
                console.log(
                    `${prefix}[UPDATE] @${telegram_username} telegram_id=${telegram_id} user_id=${record.user_id}`);
                break;
            case "unchanged":
                unchanged++;
                console.log(
                    `${prefix}[UNCHANGED] @${telegram_username} telegram_id=${telegram_id}`);
                break;
        }
    }

    console.log(
        `Summary: scanned=${packed_users.length}, created=${created}, updated=${updated}, unchanged=${unchanged}, skipped=${skipped}`);
    if (dry_run) {
        console.log("DRY RUN: to apply changes, run with --apply");
    }
    return Expected.ok(undefined);
}

async function main() {
    const dry_run = dry_run_from_argv(process.argv.slice(2));
    const cfgfile = path.join(process.cwd(), "config", "botcfg.json");
    const journal = Journal.Root();

    console.log("Starting telegram users migration...");
    console.log(`Config: ${cfgfile}`);
    console.log(`Dry run mode: ${dry_run ? "ENABLED" : "DISABLED"}`);

    const config_status = load_config(cfgfile);
    if (!config_status.ok) {
        console.error(`Failed to load configuration: ${config_status.error}`);
        process.exit(1);
    }
    const config = config_status.value;
    if (!config.tg_adapter || !config.user_service) {
        console.error("botcfg.json must specify tg_adapter and user_service");
        process.exit(1);
    }

    const runtime_path = path.resolve(config.runtime.runtime_cache_filename);
    console.log(`Runtime: ${runtime_path}`);

    let packed_users: unknown[];
    try {
        packed_users = load_packed_telegram_users(runtime_path);
    } catch (error) {
        console.error(`Failed to load runtime: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
    console.log(`Found ${packed_users.length} packed tg_adapter.users`);

    console.log("Initializing Google Auth...");
    const auth_status = await GoogleAuth.authenticate(config.json.google_cloud_key_file);
    if (!auth_status.ok) {
        console.error(`Google Auth failed: ${auth_status.error}`);
        process.exit(1);
    }

    const user_service_status = UserServiceFactory.create(config.user_service, journal);
    if (!user_service_status.ok) {
        console.error(`Failed to create user service: ${user_service_status.error}`);
        process.exit(1);
    }
    const user_service = user_service_status.value;
    const init_status = await user_service.init();
    if (!init_status.ok) {
        console.error(`Failed to init user service: ${init_status.error}`);
        process.exit(1);
    }

    const collection_status = PlainCollectionFactory.create(
        config.tg_adapter.users_storage,
        telegram_user_firestore_converter(),
        journal,
    );
    if (!collection_status.ok) {
        console.error(`Failed to create telegram users collection: ${collection_status.error}`);
        process.exit(1);
    }

    const migrate_status = await migrate(
        user_service,
        collection_status.value,
        packed_users,
        dry_run,
    );
    if (!migrate_status.ok) {
        console.error(`Migration failed: ${migrate_status.error}`);
        process.exit(1);
    }

    console.log("Telegram users migration completed successfully");
}

main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
