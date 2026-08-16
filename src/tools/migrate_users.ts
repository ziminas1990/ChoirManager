import crypto from "node:crypto";
import path from "node:path";

import { GoogleAuth } from "@src/api/google_auth.js";
import { PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { UserServiceFactory } from "@src/adapters/user_service/factory.js";
import { telegram_user_firestore_converter } from "@src/adapters/telegram/telegram_user_mapper.js";
import { TelegramUserRecord } from "@src/adapters/telegram/telegram_user_record.js";
import {
    GoogleSpreadsheetUsersStorage,
} from "@src/adapters/users_storage/google_spreadsheet.js";
import { load_config } from "@src/config.js";
import { UserData } from "@src/entities/user.js";
import { IPlainCollection } from "@src/interfaces/plain_collection.js";
import { IUserService, NewUserData } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

type Args = {
    dry_run: boolean;
    sheet_id: string;
    range: string;
}

type RosterBinding = {
    system_id: string;
    tg_username: string;
    pending: boolean;
}

function print_usage(): void {
    console.error(
        "Usage: node dist/tools/migrate_users.js --sheet-id <id> [--range Users!A:Z] [--apply]");
}

function parse_args(argv: string[]): Expected<Args> {
    let dry_run = true;
    let sheet_id: string | undefined;
    let range = "Users!A:Z";

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--apply") {
            dry_run = false;
            continue;
        }
        if (arg === "--sheet-id" || arg === "--range") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) {
                return Expected.err(`missing value for ${arg}`);
            }
            i++;
            if (arg === "--sheet-id") {
                sheet_id = value;
            } else {
                range = value;
            }
            continue;
        }
        if (arg.startsWith("--sheet-id=")) {
            sheet_id = arg.slice("--sheet-id=".length);
            continue;
        }
        if (arg.startsWith("--range=")) {
            range = arg.slice("--range=".length);
            continue;
        }
        return Expected.err(`unknown argument: ${arg}`);
    }

    if (!sheet_id) {
        return Expected.err("missing --sheet-id <id>");
    }
    return Expected.ok({ dry_run, sheet_id, range });
}

// Old UserService keyed roster rows by sha256(name + NUL + surname).
function legacy_system_id(name: string, surname: string): string {
    return crypto.createHash("sha256").update(`${name}\0${surname}`).digest("hex");
}

function new_user_from_sheet(row: UserData): NewUserData {
    return {
        name: row.name,
        surname: row.surname ?? "",
        lang: row.lang,
        voice: row.voice,
        roles: row.roles,
        tg_username: row.id.tg_username,
    };
}

function remember_binding(
    by_username: Map<string, RosterBinding>,
    by_legacy_id: Map<string, RosterBinding>,
    row: UserData,
    binding: RosterBinding,
): void {
    by_username.set(binding.tg_username, binding);
    by_legacy_id.set(legacy_system_id(row.name, row.surname ?? ""), binding);
}

async function migrate_roster(
    user_service: IUserService,
    sheet_users: UserData[],
    dry_run: boolean,
): Promise<Expected<{
    by_username: Map<string, RosterBinding>;
    by_legacy_id: Map<string, RosterBinding>;
}>> {
    const by_username = new Map<string, RosterBinding>();
    const by_legacy_id = new Map<string, RosterBinding>();
    let created = 0;
    let exists = 0;
    let skipped = 0;

    const prefix = dry_run ? "[DRY RUN] " : "";

    for (const row of sheet_users) {
        const tg_username = row.id.tg_username;
        if (!tg_username) {
            skipped++;
            console.error(`[SKIP] ${row.name} ${row.surname}: sheet row has no tgid`);
            continue;
        }

        if (by_username.has(tg_username)) {
            skipped++;
            console.error(`[SKIP] @${tg_username}: duplicate tgid in sheet, keeping first`);
            continue;
        }

        const resolved = await user_service.resolve_user({ tg_username });
        if (!resolved.ok) {
            skipped++;
            console.error(`[SKIP] @${tg_username}: ${resolved.error}`);
            continue;
        }

        if (resolved.value) {
            exists++;
            remember_binding(by_username, by_legacy_id, row, {
                system_id: resolved.value.id.system_id,
                tg_username,
                pending: false,
            });
            console.log(
                `${prefix}[EXISTS] @${tg_username} system_id=${resolved.value.id.system_id}`);
            continue;
        }

        if (dry_run) {
            created++;
            remember_binding(by_username, by_legacy_id, row, {
                system_id: `pending:@${tg_username}`,
                tg_username,
                pending: true,
            });
            console.log(`${prefix}[CREATE] @${tg_username} ${row.name} ${row.surname ?? ""}`);
            continue;
        }

        const created_user = await user_service.create(new_user_from_sheet(row));
        if (!created_user.ok) {
            skipped++;
            console.error(`[SKIP] @${tg_username}: ${created_user.error}`);
            continue;
        }

        created++;
        remember_binding(by_username, by_legacy_id, row, {
            system_id: created_user.value.id.system_id,
            tg_username,
            pending: false,
        });
        console.log(
            `[CREATE] @${tg_username} system_id=${created_user.value.id.system_id}`);
    }

    console.log(
        `Roster: scanned=${sheet_users.length}, created=${created}, exists=${exists}, skipped=${skipped}`);
    return Expected.ok({ by_username, by_legacy_id });
}

function match_telegram_record(
    record: TelegramUserRecord,
    by_username: Map<string, RosterBinding>,
    by_legacy_id: Map<string, RosterBinding>,
): RosterBinding | undefined {
    if (record.telegram_username) {
        const by_name = by_username.get(record.telegram_username);
        if (by_name) {
            return by_name;
        }
    }
    return by_legacy_id.get(record.user_id);
}

async function rebind_telegram_users(
    collection: IPlainCollection<TelegramUserRecord>,
    by_username: Map<string, RosterBinding>,
    by_legacy_id: Map<string, RosterBinding>,
    dry_run: boolean,
): Promise<Status> {
    const fetched = await collection.get_all();
    if (!fetched.ok) {
        return fetched.wrap_error("can't fetch telegram_users");
    }

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    const prefix = dry_run ? "[DRY RUN] " : "";

    for (const record of fetched.value) {
        const binding = match_telegram_record(record, by_username, by_legacy_id);
        if (!binding) {
            skipped++;
            console.error(
                `[SKIP] telegram_id=${record.id} @${record.telegram_username}: no roster match`);
            continue;
        }

        if (!binding.pending && record.user_id === binding.system_id) {
            unchanged++;
            console.log(
                `${prefix}[UNCHANGED] telegram_id=${record.id} @${record.telegram_username} user_id=${record.user_id}`);
            continue;
        }

        if (dry_run) {
            updated++;
            console.log(
                `${prefix}[UPDATE] telegram_id=${record.id} @${record.telegram_username} user_id ${record.user_id} -> ${binding.system_id}`);
            continue;
        }

        const stored = await collection.update({
            id: record.id,
            user_id: binding.system_id,
        });
        if (!stored.ok) {
            skipped++;
            console.error(
                `[SKIP] telegram_id=${record.id} @${record.telegram_username}: ${stored.error}`);
            continue;
        }

        updated++;
        console.log(
            `[UPDATE] telegram_id=${record.id} @${record.telegram_username} user_id ${record.user_id} -> ${binding.system_id}`);
    }

    console.log(
        `Telegram users: scanned=${fetched.value.length}, updated=${updated}, unchanged=${unchanged}, skipped=${skipped}`);
    return Expected.ok(undefined);
}

async function main() {
    const args_status = parse_args(process.argv.slice(2));
    if (!args_status.ok) {
        console.error(args_status.error);
        print_usage();
        process.exit(1);
    }
    const { dry_run, sheet_id, range } = args_status.value;
    const cfgfile = path.join(process.cwd(), "config", "botcfg.json");
    const journal = Journal.Root();

    console.log("Starting users collection migration...");
    console.log(`Config: ${cfgfile}`);
    console.log(`Users sheet: ${sheet_id} ${range}`);
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

    let sheet_users: UserData[];
    try {
        const sheet = new GoogleSpreadsheetUsersStorage(
            { google_sheet_id: sheet_id, range },
            journal,
        );
        sheet_users = await sheet.fetch_all();
    } catch (error) {
        console.error(
            `Failed to read users sheet: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
    console.log(`Found ${sheet_users.length} users in sheet`);

    const roster_status = await migrate_roster(user_service, sheet_users, dry_run);
    if (!roster_status.ok) {
        console.error(`Roster migration failed: ${roster_status.error}`);
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

    const rebind_status = await rebind_telegram_users(
        collection_status.value,
        roster_status.value.by_username,
        roster_status.value.by_legacy_id,
        dry_run,
    );
    if (!rebind_status.ok) {
        console.error(`Telegram rebind failed: ${rebind_status.error}`);
        process.exit(1);
    }

    if (dry_run) {
        console.log("DRY RUN: to apply changes, run with --apply");
    }
    console.log("Users collection migration completed successfully");
}

main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
