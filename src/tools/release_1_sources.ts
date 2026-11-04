import fs from "node:fs";

import { RuntimeV2, RuntimeV3, update_v2_v3 } from "@src/configuration/update_v2_v3.js";
import { Expected } from "@src/utils/expected.js";

export type RuntimeTelegramUser = {
    tgid: string;
    chat_id?: number;
};

export type RuntimeRosterUser = {
    tgid: string;
};

export type RuntimeChatSettings = {
    choir_chat_id: number | null;
    announce_thread_id: number | null;
    managers_chat_id: number | null;
};

export type RuntimeSources = {
    version: 2 | 3;
    telegram_users: RuntimeTelegramUser[];
    roster: RuntimeRosterUser[];
    chat_settings: RuntimeChatSettings;
};

// Version 2 is upgraded with update_v2_v3. Version 3 is read as
// tg_adapter.users plus the users list keyed by tgid. Any other version,
// or a version 2/3 file whose lists are missing or mistyped, is an error.
export function parse_runtime_sources(parsed: unknown): Expected<RuntimeSources> {
    if (!is_record(parsed)) {
        return Expected.err("runtime file is not a JSON object");
    }

    const version = read_version(parsed.version);
    if (!version.ok) {
        return version.cast_error();
    }

    if (version.value === 2) {
        const v2 = validate_v2(parsed);
        if (!v2.ok) {
            return v2.cast_error();
        }
        let upgraded: RuntimeV3;
        try {
            upgraded = update_v2_v3(v2.value);
        } catch (error) {
            return Expected.exception("failed to upgrade runtime v2", error);
        }
        return parse_v3_body(upgraded, 2);
    }

    return parse_v3_body(parsed, 3);
}

export function load_runtime_sources(runtime_path: string): Expected<RuntimeSources> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(runtime_path, "utf8"));
    } catch (error) {
        return Expected.exception("failed to read runtime", error);
    }
    return parse_runtime_sources(parsed);
}

function read_version(version: unknown): Expected<2 | 3> {
    if (version === undefined) {
        return Expected.err("runtime version is missing; expected version 2 or 3");
    }
    const normalized = version === "1.0" ? 1 : version;
    if (normalized === 2 || normalized === 3) {
        return Expected.ok(normalized);
    }
    const label = typeof normalized === "string" || typeof normalized === "number"
        ? String(normalized)
        : typeof normalized;
    return Expected.err(`unsupported runtime version ${label}; expected version 2 or 3`);
}

function validate_v2(root: Record<string, unknown>): Expected<RuntimeV2> {
    if (!Array.isArray(root.users)) {
        return Expected.err("runtime.users is missing or not an array (version 2)");
    }
    for (let index = 0; index < root.users.length; index++) {
        const status = validate_v2_user(root.users[index], index);
        if (!status.ok) {
            return status.cast_error();
        }
    }
    if (root.cfg !== undefined) {
        const cfg_status = validate_v2_cfg(root.cfg);
        if (!cfg_status.ok) {
            return cfg_status.cast_error();
        }
    }
    return Expected.ok(root as unknown as RuntimeV2);
}

function validate_v2_user(value: unknown, index: number): Expected<void> {
    const pair = parse_roster_entry(value, index);
    if (!pair.ok) {
        return pair.as_status();
    }
    const packed = (value as [string, Record<string, unknown>])[1];
    if (packed.dlg === undefined) {
        return Expected.ok(undefined);
    }
    if (!Array.isArray(packed.dlg)) {
        return Expected.err(`runtime.users[${index}].dlg must be an array of integers`);
    }
    for (let dlg_index = 0; dlg_index < packed.dlg.length; dlg_index++) {
        const chat_id = packed.dlg[dlg_index];
        if (typeof chat_id !== "number" || !Number.isInteger(chat_id)) {
            return Expected.err(`runtime.users[${index}].dlg must be an array of integers`);
        }
    }
    return Expected.ok(undefined);
}

function validate_v2_cfg(cfg: unknown): Expected<void> {
    if (!is_record(cfg)) {
        return Expected.err("runtime.cfg is not an object (version 2)");
    }
    const fields = ["chat_id", "announces_chat_id", "manager_chat_id"] as const;
    for (const field of fields) {
        const status = read_optional_integer(cfg[field], `runtime.cfg.${field}`);
        if (!status.ok) {
            return status.as_status();
        }
    }
    return Expected.ok(undefined);
}

function parse_v3_body(packed: object, version: 2 | 3): Expected<RuntimeSources> {
    const root = packed as Record<string, unknown>;
    if (!is_record(root.tg_adapter)) {
        return Expected.err(`runtime.tg_adapter is missing or not an object (version ${version})`);
    }
    const adapter = root.tg_adapter;

    const telegram_users = parse_telegram_users(adapter.users, version);
    if (!telegram_users.ok) {
        return telegram_users.cast_error();
    }

    const roster = parse_roster(root.users, version);
    if (!roster.ok) {
        return roster.cast_error();
    }

    const choir_chat_id = read_optional_integer(
        adapter.choir_chat_id,
        "runtime.tg_adapter.choir_chat_id",
    );
    if (!choir_chat_id.ok) {
        return choir_chat_id.cast_error();
    }
    const announce_thread_id = read_optional_integer(
        adapter.announce_thread_id,
        "runtime.tg_adapter.announce_thread_id",
    );
    if (!announce_thread_id.ok) {
        return announce_thread_id.cast_error();
    }
    const managers_chat_id = read_optional_integer(
        adapter.managers_chat_id,
        "runtime.tg_adapter.managers_chat_id",
    );
    if (!managers_chat_id.ok) {
        return managers_chat_id.cast_error();
    }

    return Expected.ok({
        version,
        telegram_users: telegram_users.value,
        roster: roster.value,
        chat_settings: {
            choir_chat_id: choir_chat_id.value,
            announce_thread_id: announce_thread_id.value,
            managers_chat_id: managers_chat_id.value,
        },
    });
}

function parse_telegram_users(
    users: unknown,
    version: 2 | 3,
): Expected<RuntimeTelegramUser[]> {
    if (!Array.isArray(users)) {
        return Expected.err(
            `runtime.tg_adapter.users is missing or not an array (version ${version})`);
    }
    const parsed: RuntimeTelegramUser[] = [];
    for (let index = 0; index < users.length; index++) {
        const user = parse_telegram_user(users[index], index);
        if (!user.ok) {
            return user.cast_error();
        }
        parsed.push(user.value);
    }
    return Expected.ok(parsed);
}

function parse_telegram_user(value: unknown, index: number): Expected<RuntimeTelegramUser> {
    if (!is_record(value)) {
        return Expected.err(`runtime.tg_adapter.users[${index}] is not an object`);
    }
    if (typeof value.tgid !== "string" || value.tgid.length === 0) {
        return Expected.err(`runtime.tg_adapter.users[${index}].tgid must be a non-empty string`);
    }
    const chat_id = read_optional_integer(
        value.chat_id,
        `runtime.tg_adapter.users[${index}].chat_id`,
    );
    if (!chat_id.ok) {
        return chat_id.cast_error();
    }
    const user: RuntimeTelegramUser = { tgid: value.tgid };
    if (chat_id.value !== null) {
        user.chat_id = chat_id.value;
    }
    return Expected.ok(user);
}

function parse_roster(users: unknown, version: 2 | 3): Expected<RuntimeRosterUser[]> {
    if (!Array.isArray(users)) {
        return Expected.err(`runtime.users is missing or not an array (version ${version})`);
    }
    const roster: RuntimeRosterUser[] = [];
    for (let index = 0; index < users.length; index++) {
        const entry = parse_roster_entry(users[index], index);
        if (!entry.ok) {
            return entry.cast_error();
        }
        roster.push(entry.value);
    }
    return Expected.ok(roster);
}

function parse_roster_entry(value: unknown, index: number): Expected<RuntimeRosterUser> {
    if (!Array.isArray(value) || value.length !== 2) {
        return Expected.err(`runtime.users[${index}] must be a [tgid, user] pair`);
    }
    const [key, packed] = value;
    if (typeof key !== "string" || key.length === 0) {
        return Expected.err(`runtime.users[${index}] key must be a non-empty string`);
    }
    if (!is_record(packed)) {
        return Expected.err(`runtime.users[${index}] value is not an object`);
    }
    if (typeof packed.tgid !== "string" || packed.tgid.length === 0) {
        return Expected.err(`runtime.users[${index}].tgid must be a non-empty string`);
    }
    if (key !== packed.tgid) {
        return Expected.err(
            `runtime.users[${index}] key '${key}' does not match tgid '${packed.tgid}'`);
    }
    return Expected.ok({ tgid: packed.tgid });
}

function read_optional_integer(value: unknown, label: string): Expected<number | null> {
    if (value === undefined) {
        return Expected.ok(null);
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return Expected.err(`${label} must be an integer`);
    }
    return Expected.ok(value);
}

function is_record(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}
