import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleAuth } from "@src/api/google_auth.js";
import { PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { telegram_user_firestore_converter } from "@src/adapters/telegram/telegram_user_mapper.js";
import {
    TelegramUserRecord,
    telegram_user_record_id,
} from "@src/adapters/telegram/telegram_user_record.js";
import { UserServiceFactory } from "@src/adapters/user_service/factory.js";
import { GoogleSpreadsheetUsersStorage } from "@src/adapters/users_storage/google_spreadsheet.js";
import { UserService } from "@src/components/user_service.js";
import { BotConfig, load_config } from "@src/config.js";
import { IPlainCollection } from "@src/interfaces/plain_collection.js";
import { Journal } from "@src/journal.js";
import {
    PlanRecord,
    PlanRecordStatus,
    PlannedBinding,
    Release1Plan,
    plan_release_1,
    run_release_1_plan,
    verify_migrated_bindings,
} from "@src/tools/release_1_plan.js";
import {
    load_runtime_sources,
    RuntimeChatSettings,
} from "@src/tools/release_1_sources.js";
import { Expected } from "@src/utils/expected.js";

const DEFAULT_RANGE = "Users!A:Z";
const DEFAULT_REPORT_PATH = "migrate-release-1-report.json";

const OPTIONS = ["--runtime", "--users-sheet-id", "--range", "--report"] as const;

type OptionFlag = typeof OPTIONS[number];

export type MigrateRelease1Args = {
    dry_run: boolean;
    runtime_path?: string;
    users_sheet_id: string;
    range: string;
    report_path: string;
};

export type MigrationRecordStatus = PlanRecordStatus;

export type MigrationRecord = PlanRecord;

export type MigrationSources = {
    sheet_rows: number | null;
    runtime_users: number | null;
    runtime_roster: number | null;
    telegram_users: number | null;
};

export type MigrationPostCheck = "not_run" | "passed" | "failed";

export type MigrationReport = {
    dry_run: boolean;
    runtime_path: string;
    users_sheet_id: string;
    range: string;
    // Re-reading bindings after a write sets this. "not_run" is not a failure.
    post_check: MigrationPostCheck;
    chat_settings: RuntimeChatSettings | null;
    sources: MigrationSources;
    summary: Record<PlanRecordStatus, number>;
    records: MigrationRecord[];
};

export function parse_migrate_release_1_args(argv: string[]): Expected<MigrateRelease1Args> {
    let dry_run = true;
    let runtime_path: string | undefined;
    let users_sheet_id: string | undefined;
    let range = DEFAULT_RANGE;
    let report_path = DEFAULT_REPORT_PATH;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--apply") {
            dry_run = false;
            continue;
        }

        const flag = OPTIONS.find((name) => arg === name || arg.startsWith(`${name}=`));
        if (!flag) {
            return Expected.err(`unknown argument: ${arg}`);
        }

        const value_status = read_option_value(argv, i, arg, flag);
        if (!value_status.ok) {
            return value_status.cast_error();
        }
        if (arg === flag) {
            i++;
        }

        switch (flag) {
            case "--runtime":
                runtime_path = value_status.value;
                break;
            case "--users-sheet-id":
                users_sheet_id = value_status.value;
                break;
            case "--range":
                range = value_status.value;
                break;
            case "--report":
                report_path = value_status.value;
                break;
        }
    }

    if (!users_sheet_id || !users_sheet_id.trim()) {
        return Expected.err("missing --users-sheet-id <id>");
    }

    return Expected.ok({
        dry_run,
        runtime_path,
        users_sheet_id,
        range,
        report_path,
    });
}

// Nonzero when a source record was skipped, a conflict is unresolved,
// a read or write failed, or the post-write binding check failed.
export function migration_exit_code(report: MigrationReport): 0 | 1 {
    if (report.post_check === "failed") {
        return 1;
    }
    if (report.summary.error > 0 || report.summary.skipped > 0 || report.summary.conflict > 0) {
        return 1;
    }
    return 0;
}

function print_usage(): void {
    console.error(
        "Usage: node migrate.cjs --users-sheet-id <id> "
        + "[--runtime <path>] [--range <range>] [--report <path>] [--apply]");
    console.error(
        "       npm run migrate-release-1 -- --users-sheet-id <id> "
        + "[--runtime <path>] [--range <range>] [--report <path>] [--apply]");
    console.error("  --users-sheet-id <id>  users spreadsheet id (required)");
    console.error("  --runtime <path>       runtime.json (default: runtime_cache_filename from config/botcfg.json)");
    console.error(`  --range <range>        sheet range (default: ${DEFAULT_RANGE})`);
    console.error(`  --report <path>        JSON report file (default: ${DEFAULT_REPORT_PATH})`);
    console.error("  --apply                write changes (default: dry run)");
}

function new_report(args: MigrateRelease1Args): MigrationReport {
    return {
        dry_run: args.dry_run,
        runtime_path: args.runtime_path ? path.resolve(args.runtime_path) : "",
        users_sheet_id: args.users_sheet_id,
        range: args.range,
        post_check: "not_run",
        chat_settings: null,
        sources: {
            sheet_rows: null,
            runtime_users: null,
            runtime_roster: null,
            telegram_users: null,
        },
        summary: {
            created: 0,
            unchanged: 0,
            updated: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
        },
        records: [],
    };
}

function add_record(report: MigrationReport, record: MigrationRecord): void {
    report.records.push(record);
    report.summary[record.status] += 1;
    console.log(format_record(report.dry_run, record));
}

function format_record(dry_run: boolean, record: MigrationRecord): string {
    const actionable = record.status === "created"
        || record.status === "updated"
        || record.status === "unchanged";
    const prefix = dry_run && actionable ? "[DRY RUN] " : "";
    const category = record.category ? ` (${record.category})` : "";
    return `${prefix}[${record.status.toUpperCase()}]${category} ${record.source} ${record.key}: ${record.message}`;
}

function finish_report(report: MigrationReport, report_path: string): 0 | 1 {
    const summary = report.summary;
    console.log(
        `Summary: created=${summary.created} unchanged=${summary.unchanged} `
        + `updated=${summary.updated} skipped=${summary.skipped} `
        + `conflict=${summary.conflict} error=${summary.error}`);
    console.log(
        `Sources: sheet=${format_count(report.sources.sheet_rows)} `
        + `runtime=${format_count(report.sources.runtime_users)} `
        + `roster=${format_count(report.sources.runtime_roster)} `
        + `telegram_users=${format_count(report.sources.telegram_users)}`);
    console.log(`Chat settings: ${format_chat_settings(report.chat_settings)}`);
    console.log(`Post-check: ${report.post_check}`);
    if (report.dry_run) {
        console.log("Dry run: no changes written. To apply, run with --apply");
    }

    let code = migration_exit_code(report);
    try {
        fs.writeFileSync(report_path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        console.log(`Report written to ${report_path}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to write report ${report_path}: ${message}`);
        code = 1;
    }

    if (code === 0) {
        console.log("Migration completed");
    } else {
        console.log("Migration incomplete");
    }
    return code;
}

async function run_migration(args: MigrateRelease1Args, report: MigrationReport): Promise<void> {
    const cfgfile = path.join(process.cwd(), "config", "botcfg.json");
    console.log("Starting release 1 user migration...");
    console.log(`Config: ${cfgfile}`);
    console.log(`Users sheet: ${args.users_sheet_id} ${args.range}`);
    console.log(`Dry run mode: ${args.dry_run ? "ENABLED" : "DISABLED"}`);
    console.log(`Report: ${path.resolve(args.report_path)}`);

    const config_status = load_config(cfgfile);
    if (!config_status.ok) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: cfgfile,
            message: config_status.error,
        });
        return;
    }
    const config = config_status.value;
    if (!config.tg_adapter || !config.user_service) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: cfgfile,
            message: "botcfg.json must specify tg_adapter and user_service",
        });
        return;
    }

    report.runtime_path = path.resolve(args.runtime_path ?? config.runtime.runtime_cache_filename);
    console.log(`Runtime: ${report.runtime_path}`);

    const runtime_sources = load_runtime_sources(report.runtime_path);
    if (!runtime_sources.ok) {
        add_record(report, {
            status: "error",
            source: "runtime",
            key: report.runtime_path,
            message: runtime_sources.error,
        });
        return;
    }
    report.sources.runtime_users = runtime_sources.value.telegram_users.length;
    report.sources.runtime_roster = runtime_sources.value.roster.length;
    report.chat_settings = runtime_sources.value.chat_settings;
    console.log(
        `Runtime version ${runtime_sources.value.version}: `
        + `${runtime_sources.value.telegram_users.length} tg_adapter.users, `
        + `${runtime_sources.value.roster.length} users keyed by tgid`);

    const opened = await open_services(config, report);
    if (!opened) {
        return;
    }

    const existing = await opened.collection.get_all();
    if (!existing.ok) {
        add_record(report, {
            status: "error",
            source: "telegram_users",
            key: "telegram_users",
            message: existing.error,
        });
        return;
    }
    report.sources.telegram_users = existing.value.length;
    console.log(`Found ${existing.value.length} telegram_users`);

    const sheet = new GoogleSpreadsheetUsersStorage(
        { google_sheet_id: args.users_sheet_id, range: args.range },
        opened.journal,
    );
    const sheet_read = await sheet.fetch_all();
    if (!sheet_read.ok) {
        add_record(report, {
            status: "error",
            source: "sheet",
            key: args.users_sheet_id,
            message: sheet_read.error,
        });
        return;
    }
    const sheet_users = sheet_read.value.rows;
    report.sources.sheet_rows = sheet_users.length + sheet_read.value.errors.length;
    console.log(
        `Found ${sheet_users.length} users in sheet `
        + `(${sheet_read.value.errors.length} unreadable rows)`);

    const plan = plan_release_1({
        sheet_rows: sheet_users,
        sheet_errors: sheet_read.value.errors,
        runtime_telegram_users: runtime_sources.value.telegram_users,
        runtime_roster: runtime_sources.value.roster,
        existing_users: await opened.user_service.fetch_all(),
        existing_bindings: existing.value,
    });
    const applied = await run_release_1_plan(args.dry_run, plan, {
        create_user: (user) => opened.user_service.create(user),
        save_binding: (binding, system_id) => save_binding(opened.collection, binding, system_id),
    });
    publish_plan(report, plan, applied !== undefined);
    if (!applied) {
        return;
    }
    for (const record of applied.records) {
        add_record(report, record);
    }
    await verify_after_write(opened.user_service, opened.collection, plan, applied.assigned, report);
}

async function main(): Promise<void> {
    const args_status = parse_migrate_release_1_args(process.argv.slice(2));
    if (!args_status.ok) {
        console.error(args_status.error);
        print_usage();
        process.exit(1);
    }

    const args = args_status.value;
    const report = new_report(args);
    const report_path = path.resolve(args.report_path);
    try {
        await run_migration(args, report);
    } catch (error) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: "migrate-release-1",
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const code = finish_report(report, report_path);
    process.exit(code);
}

function is_main_module(): boolean {
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    // The CJS image bundle empties import.meta. That file is the command.
    const url = import.meta.url;
    if (!url) {
        return true;
    }
    return path.resolve(entry) === path.resolve(fileURLToPath(url));
}

if (is_main_module()) {
    main().catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}

function read_option_value(
    argv: string[],
    index: number,
    arg: string,
    flag: OptionFlag,
): Expected<string> {
    if (arg === flag) {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
            return Expected.err(`missing value for ${flag}`);
        }
        return Expected.ok(value);
    }

    const value = arg.slice(flag.length + 1);
    if (!value) {
        return Expected.err(`missing value for ${flag}`);
    }
    return Expected.ok(value);
}

function format_count(value: number | null): string {
    return value === null ? "unread" : String(value);
}

function format_chat_settings(settings: RuntimeChatSettings | null): string {
    if (!settings) {
        return "unread";
    }
    return `choir_chat_id=${format_setting(settings.choir_chat_id)} `
        + `announce_thread_id=${format_setting(settings.announce_thread_id)} `
        + `managers_chat_id=${format_setting(settings.managers_chat_id)}`;
}

function format_setting(value: number | null): string {
    return value === null ? "absent" : String(value);
}

function publish_plan(report: MigrationReport, plan: Release1Plan, applied: boolean): void {
    for (const record of plan.records) {
        if (applied && (record.status === "created" || record.status === "updated")) {
            continue;
        }
        add_record(report, record);
    }
}

async function save_binding(
    collection: IPlainCollection<TelegramUserRecord>,
    binding: PlannedBinding,
    system_id: string,
): Promise<Expected<void>> {
    const id = telegram_user_record_id(binding.telegram_id);
    const fields = {
        user_id: system_id,
        telegram_username: binding.telegram_username,
        private_chat_id: binding.private_chat_id,
    };
    if (binding.action === "create") {
        const created = await collection.create({
            id,
            revision: 1,
            ...fields,
        });
        return created.ok ? Expected.ok(undefined) : created.cast_error();
    }
    const updated = await collection.update({
        id,
        ...fields,
    });
    return updated.ok ? Expected.ok(undefined) : updated.cast_error();
}

async function verify_after_write(
    user_service: UserService,
    collection: IPlainCollection<TelegramUserRecord>,
    plan: Release1Plan,
    assigned: ReadonlyMap<string, string>,
    report: MigrationReport,
): Promise<void> {
    const refreshed = await user_service.init();
    if (!refreshed.ok) {
        report.post_check = "failed";
        add_record(report, {
            status: "error",
            source: "telegram_users",
            key: "post_check",
            message: refreshed.error,
        });
        return;
    }

    const bindings = await collection.get_all();
    if (!bindings.ok) {
        report.post_check = "failed";
        add_record(report, {
            status: "error",
            source: "telegram_users",
            key: "post_check",
            message: bindings.error,
        });
        return;
    }

    const problems = verify_migrated_bindings(
        await user_service.fetch_all(),
        bindings.value,
        plan,
        assigned,
    );
    if (problems.length === 0) {
        report.post_check = "passed";
        return;
    }

    report.post_check = "failed";
    for (const problem of problems) {
        add_record(report, {
            status: "error",
            source: "telegram_users",
            key: "post_check",
            message: problem,
        });
    }
}

async function open_services(
    config: BotConfig,
    report: MigrationReport,
): Promise<{
    journal: Journal;
    user_service: UserService;
    collection: IPlainCollection<TelegramUserRecord>;
} | undefined> {
    const journal = Journal.Root();
    if (!config.tg_adapter || !config.user_service) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: "botcfg.json",
            message: "botcfg.json must specify tg_adapter and user_service",
        });
        return undefined;
    }

    console.log("Initializing Google Auth...");
    const auth_status = await GoogleAuth.authenticate(config.json.google_cloud_key_file);
    if (!auth_status.ok) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: config.json.google_cloud_key_file,
            message: `Google Auth failed: ${auth_status.error}`,
        });
        return undefined;
    }

    const user_service_status = UserServiceFactory.create(config.user_service, journal);
    if (!user_service_status.ok) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: "user_service",
            message: user_service_status.error,
        });
        return undefined;
    }
    const user_service = user_service_status.value;
    const init_status = await user_service.init();
    if (!init_status.ok) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: "user_service",
            message: init_status.error,
        });
        return undefined;
    }

    const collection_status = PlainCollectionFactory.create(
        config.tg_adapter.users_storage,
        telegram_user_firestore_converter(),
        journal,
    );
    if (!collection_status.ok) {
        add_record(report, {
            status: "error",
            source: "setup",
            key: "telegram_users",
            message: collection_status.error,
        });
        return undefined;
    }

    return {
        journal,
        user_service,
        collection: collection_status.value,
    };
}
