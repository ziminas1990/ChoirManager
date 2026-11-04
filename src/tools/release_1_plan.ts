import crypto from "node:crypto";

import { TelegramUserRecord } from "@src/adapters/telegram/telegram_user_record.js";
import { Language, Role, UserData, Voice } from "@src/entities/user.js";
import { NewUserData } from "@src/interfaces/user_service.js";
import {
    RuntimeRosterUser,
    RuntimeTelegramUser,
} from "@src/tools/release_1_sources.js";
import { Expected } from "@src/utils/expected.js";

export const PLAN_RECORD_STATUSES = [
    "created",
    "unchanged",
    "updated",
    "skipped",
    "conflict",
    "error",
] as const;

export type PlanRecordStatus = typeof PLAN_RECORD_STATUSES[number];

export const FINDING_CATEGORIES = [
    "read_error",
    "duplicate_tgid",
    "ambiguous_username",
    "telegram_id_collision",
    "chat_id_mismatch",
    "missing_chat_id",
    "unmatched_binding",
] as const;

export type FindingCategory = typeof FINDING_CATEGORIES[number];

export type PlanRecordSource = "setup" | "sheet" | "runtime" | "telegram_users";

export type PlanRecord = {
    status: PlanRecordStatus;
    source: PlanRecordSource;
    key: string;
    message: string;
    category?: FindingCategory;
};

export type PlannedUser = {
    action: "create" | "unchanged";
    source: "sheet" | "runtime";
    tg_username: string;
    system_id?: string;
    name: string;
    surname: string;
    lang: Language;
    voice: Voice;
    roles: Role[];
    runtime_only: boolean;
};

export type PlannedUserRef =
    | { kind: "system_id"; system_id: string }
    | { kind: "username"; tg_username: string };

export type PlannedBinding = {
    action: "create" | "update" | "unchanged";
    telegram_id: number;
    telegram_username: string;
    private_chat_id: number;
    user_ref: PlannedUserRef;
    previous_user_id?: string;
};

export type SheetRowError = {
    row: number;
    tgid: string;
    message: string;
};

export type Release1PlanInput = {
    sheet_rows: UserData[];
    sheet_errors: SheetRowError[];
    runtime_telegram_users: RuntimeTelegramUser[];
    runtime_roster: RuntimeRosterUser[];
    existing_users: UserData[];
    existing_bindings: TelegramUserRecord[];
};

export type Release1Plan = {
    records: PlanRecord[];
    users: PlannedUser[];
    bindings: PlannedBinding[];
};

export type Release1Writers = {
    create_user(user: NewUserData): Promise<Expected<UserData>>;
    save_binding(binding: PlannedBinding, system_id: string): Promise<Expected<void>>;
};

export type Release1ApplyResult = {
    records: PlanRecord[];
    assigned: Map<string, string>;
};

type BindingLink = {
    telegram_id: number;
    telegram_username: string;
    private_chat_id: number;
    user: PlannedUser;
};

// Pure: sheet, runtime, and the current Firestore snapshot in, actions out.
export function plan_release_1(input: Release1PlanInput): Release1Plan {
    return new Planner(input).plan();
}

// Dry run returns without calling writers. Apply writes users, then bindings.
export async function run_release_1_plan(
    dry_run: boolean,
    plan: Release1Plan,
    writers: Release1Writers,
): Promise<Release1ApplyResult | undefined> {
    if (dry_run) {
        return undefined;
    }
    return apply_release_1_plan(plan, writers);
}

export async function apply_release_1_plan(
    plan: Release1Plan,
    writers: Release1Writers,
): Promise<Release1ApplyResult> {
    const records: PlanRecord[] = [];
    const assigned = new Map<string, string>();

    for (const user of plan.users) {
        if (user.action === "unchanged") {
            if (user.system_id) {
                assigned.set(user.tg_username, user.system_id);
            }
            continue;
        }

        const created = await writers.create_user(new_user_data(user));
        if (!created.ok) {
            records.push({
                status: "error",
                source: user.source,
                key: username_key(user.tg_username),
                message: created.error,
            });
            continue;
        }

        assigned.set(user.tg_username, created.value.id.system_id);
        records.push(user_record(user, created.value.id.system_id));
    }

    for (const binding of plan.bindings) {
        if (binding.action === "unchanged") {
            continue;
        }

        const system_id = resolve_user_ref(binding.user_ref, assigned);
        const key = binding_key(binding.telegram_username, binding.telegram_id);
        if (!system_id) {
            records.push({
                status: "error",
                source: "telegram_users",
                key,
                message: `user @${binding.telegram_username} was not created`,
            });
            continue;
        }

        const saved = await writers.save_binding(binding, system_id);
        if (!saved.ok) {
            records.push({
                status: "error",
                source: "telegram_users",
                key,
                message: saved.error,
            });
            continue;
        }

        records.push(binding_record(binding, system_id));
    }

    return { records, assigned };
}

// Every planned binding must point at a user that was read back from storage.
export function verify_migrated_bindings(
    users: readonly UserData[],
    bindings: readonly TelegramUserRecord[],
    plan: Release1Plan,
    assigned: ReadonlyMap<string, string>,
): string[] {
    const ids = new Set(users.map((user) => user.id.system_id));
    const by_telegram_id = new Map(bindings.map((binding) => [binding.id, binding]));
    const problems: string[] = [];

    for (const binding of plan.bindings) {
        const telegram_id = String(binding.telegram_id);
        const expected = resolve_user_ref(binding.user_ref, assigned);
        const stored = by_telegram_id.get(telegram_id);
        if (!expected) {
            problems.push(`telegram_id=${telegram_id} has no user id`);
            continue;
        }
        if (!stored) {
            problems.push(`telegram_id=${telegram_id} was not stored`);
            continue;
        }
        if (stored.user_id !== expected) {
            problems.push(
                `telegram_id=${telegram_id} points at ${stored.user_id}, expected ${expected}`);
            continue;
        }
        if (!ids.has(stored.user_id)) {
            problems.push(`telegram_id=${telegram_id} points at missing user ${stored.user_id}`);
        }
    }

    return problems;
}

export function plan_has_blocking_findings(plan: Release1Plan): boolean {
    return plan.records.some((record) =>
        record.status === "error"
        || record.status === "skipped"
        || record.status === "conflict");
}

class Planner {
    private readonly records: PlanRecord[] = [];
    private readonly users: PlannedUser[] = [];
    private readonly bindings: PlannedBinding[] = [];
    private readonly users_by_username = new Map<string, PlannedUser>();

    constructor(private readonly input: Release1PlanInput) {}

    plan(): Release1Plan {
        this.add_sheet_errors();
        const blocked = this.blocked_usernames();
        const existing = this.index_existing_users();
        const sheet_names = this.add_sheet_users(blocked, existing);
        this.add_runtime_only_users(blocked, existing, sheet_names);
        this.add_bindings(blocked);
        return {
            records: this.records,
            users: this.users,
            bindings: this.bindings,
        };
    }

    private add_sheet_errors(): void {
        for (const error of this.input.sheet_errors) {
            this.records.push({
                status: "error",
                source: "sheet",
                category: "read_error",
                key: error.tgid.length > 0 ? username_key(error.tgid) : `row ${error.row}`,
                message: `row ${error.row}: ${error.message}`,
            });
        }
    }

    private blocked_usernames(): Set<string> {
        const groups = new Map<string, Map<string, PlanRecordSource>>();
        const add = (verbatim: string | undefined, source: PlanRecordSource) => {
            if (!verbatim) {
                return;
            }
            const key = identity_key(verbatim);
            if (!key) {
                return;
            }
            let forms = groups.get(key);
            if (!forms) {
                forms = new Map();
                groups.set(key, forms);
            }
            if (!forms.has(verbatim)) {
                forms.set(verbatim, source);
            }
        };

        for (const row of this.input.sheet_rows) {
            add(row.id.tg_username, "sheet");
        }
        for (const user of this.input.runtime_telegram_users) {
            add(user.tgid, "runtime");
        }
        for (const user of this.input.runtime_roster) {
            add(user.tgid, "runtime");
        }
        for (const user of this.input.existing_users) {
            add(user.id.tg_username, "setup");
        }
        for (const binding of this.input.existing_bindings) {
            add(binding.telegram_username, "telegram_users");
        }

        const blocked = new Set<string>();
        for (const forms of groups.values()) {
            if (forms.size <= 1) {
                continue;
            }
            const listed = [...forms.keys()];
            for (const verbatim of listed) {
                blocked.add(verbatim);
                const source = forms.get(verbatim);
                if (!source || source === "setup") {
                    continue;
                }
                const others = listed.filter((name) => name !== verbatim);
                this.records.push({
                    status: "conflict",
                    source,
                    category: "ambiguous_username",
                    key: username_key(verbatim),
                    message: `differs only by case or '@' from ${others.join(", ")}`,
                });
            }
        }
        return blocked;
    }

    private index_existing_users(): Map<string, UserData> {
        const indexed = new Map<string, UserData>();
        const duplicates = new Set<string>();
        for (const user of this.input.existing_users) {
            const username = user.id.tg_username;
            if (!username) {
                continue;
            }
            if (indexed.has(username) || duplicates.has(username)) {
                duplicates.add(username);
                indexed.delete(username);
                continue;
            }
            indexed.set(username, user);
        }
        for (const username of duplicates) {
            this.records.push({
                status: "conflict",
                source: "setup",
                category: "duplicate_tgid",
                key: username_key(username),
                message: "duplicate tg_username in Firestore, not migrating",
            });
        }
        return indexed;
    }

    private add_sheet_users(blocked: Set<string>, existing: Map<string, UserData>): Set<string> {
        const kept = new Set<string>();
        for (const row of this.input.sheet_rows) {
            const username = row.id.tg_username;
            const label = `${row.name} ${row.surname}`.trim();
            if (!username) {
                this.records.push({
                    status: "skipped",
                    source: "sheet",
                    key: label || "(blank row)",
                    message: "sheet row has no tgid",
                });
                continue;
            }
            if (blocked.has(username)) {
                continue;
            }
            if (kept.has(username)) {
                this.records.push({
                    status: "conflict",
                    source: "sheet",
                    category: "duplicate_tgid",
                    key: username_key(username),
                    message: "duplicate tgid in sheet, keeping first",
                });
                continue;
            }
            kept.add(username);
            if (!existing.has(username) && this.firestore_duplicate(username)) {
                continue;
            }
            this.add_user(this.user_from_sheet(row, existing.get(username)), false);
        }
        return kept;
    }

    private add_runtime_only_users(
        blocked: Set<string>,
        existing: Map<string, UserData>,
        sheet_names: Set<string>,
    ): void {
        const seen = new Set<string>();
        const names = [
            ...this.input.runtime_telegram_users.map((user) => user.tgid),
            ...this.input.runtime_roster.map((user) => user.tgid),
        ];
        for (const username of names) {
            if (!username || blocked.has(username) || sheet_names.has(username)) {
                continue;
            }
            if (seen.has(username)) {
                this.records.push({
                    status: "conflict",
                    source: "runtime",
                    category: "duplicate_tgid",
                    key: username_key(username),
                    message: "duplicate tgid in runtime, keeping first",
                });
                continue;
            }
            seen.add(username);
            if (!existing.has(username) && this.firestore_duplicate(username)) {
                continue;
            }
            this.add_user(this.user_from_runtime(username, existing.get(username)), true);
        }
    }

    private add_user(user: PlannedUser, runtime_only: boolean): void {
        const planned: PlannedUser = { ...user, runtime_only, roles: [...user.roles] };
        this.users.push(planned);
        this.users_by_username.set(planned.tg_username, planned);
        this.records.push(user_record(planned, planned.system_id));
    }

    private add_bindings(blocked: Set<string>): void {
        const links = new Map<string, BindingLink>();
        const claimed_ids = new Set<number>();

        for (const packed of this.input.runtime_telegram_users) {
            if (packed.chat_id === undefined) {
                if (!blocked.has(packed.tgid)) {
                    this.records.push({
                        status: "skipped",
                        source: "runtime",
                        category: "missing_chat_id",
                        key: username_key(packed.tgid),
                        message: "chat_id is missing",
                    });
                }
                continue;
            }
            if (blocked.has(packed.tgid)) {
                continue;
            }
            const user = this.users_by_username.get(packed.tgid);
            if (!user) {
                continue;
            }
            const link: BindingLink = {
                telegram_id: packed.chat_id,
                telegram_username: packed.tgid,
                private_chat_id: packed.chat_id,
                user,
            };
            links.set(link_key(link.telegram_id, link.telegram_username), link);
            claimed_ids.add(link.telegram_id);
        }

        const legacy = this.legacy_index();
        for (const stored of this.input.existing_bindings) {
            const telegram_id = Number(stored.id);
            if (!Number.isInteger(telegram_id)) {
                this.records.push({
                    status: "error",
                    source: "telegram_users",
                    category: "read_error",
                    key: `telegram_id=${stored.id}`,
                    message: "telegram id is not an integer",
                });
                continue;
            }

            const named = stored.telegram_username
                ? this.users_by_username.get(stored.telegram_username)
                : undefined;
            if (named && !blocked.has(stored.telegram_username)) {
                if (!links.has(link_key(telegram_id, named.tg_username))) {
                    links.set(link_key(telegram_id, named.tg_username), {
                        telegram_id,
                        telegram_username: named.tg_username,
                        private_chat_id: stored.private_chat_id,
                        user: named,
                    });
                }
                continue;
            }

            if (stored.telegram_username && blocked.has(stored.telegram_username)) {
                continue;
            }

            if (claimed_ids.has(telegram_id)) {
                const occupiers = links_for_telegram_id(links, telegram_id);
                const stored_name = stored.telegram_username;
                const conflicts = stored_name.length > 0
                    && occupiers.some((link) => link.telegram_username !== stored_name);
                if (conflicts) {
                    for (const occupier of occupiers) {
                        links.delete(link_key(occupier.telegram_id, occupier.telegram_username));
                    }
                    claimed_ids.delete(telegram_id);
                    const names = [...new Set([
                        ...occupiers.map((link) => `@${link.telegram_username}`),
                        `@${stored_name}`,
                    ])];
                    this.records.push({
                        status: "conflict",
                        source: "telegram_users",
                        category: "telegram_id_collision",
                        key: `telegram_id=${telegram_id}`,
                        message: `claimed by ${names.join(", ")}`,
                    });
                }
                continue;
            }

            const hits = legacy.get(stored.user_id) ?? [];
            if (hits.length > 1) {
                this.records.push({
                    status: "conflict",
                    source: "telegram_users",
                    category: "telegram_id_collision",
                    key: `telegram_id=${stored.id}`,
                    message: "legacy id matches several sheet users",
                });
                continue;
            }
            if (hits.length === 1) {
                const hit = hits[0];
                if (stored.telegram_username && stored.telegram_username !== hit.tg_username) {
                    this.records.push({
                        status: "conflict",
                        source: "telegram_users",
                        category: "telegram_id_collision",
                        key: binding_key(stored.telegram_username, telegram_id),
                        message: `also matches @${hit.tg_username} by legacy id`,
                    });
                    continue;
                }
                links.set(link_key(telegram_id, hit.tg_username), {
                    telegram_id,
                    telegram_username: stored.telegram_username || hit.tg_username,
                    private_chat_id: stored.private_chat_id,
                    user: hit,
                });
                continue;
            }

            this.records.push({
                status: "skipped",
                source: "telegram_users",
                category: "unmatched_binding",
                key: stored.telegram_username
                    ? binding_key(stored.telegram_username, telegram_id)
                    : `telegram_id=${stored.id}`,
                message: "no roster match",
            });
        }

        const kept = this.drop_binding_conflicts(links);
        const stored_by_id = new Map(this.input.existing_bindings.map((binding) => [binding.id, binding]));
        for (const link of kept) {
            const stored = stored_by_id.get(String(link.telegram_id));
            const user_ref = user_ref_for(link.user);
            const desired_user_id = link.user.system_id;
            if (!stored) {
                this.bindings.push({
                    action: "create",
                    telegram_id: link.telegram_id,
                    telegram_username: link.telegram_username,
                    private_chat_id: link.private_chat_id,
                    user_ref,
                });
                this.records.push(binding_record({
                    action: "create",
                    telegram_id: link.telegram_id,
                    telegram_username: link.telegram_username,
                    private_chat_id: link.private_chat_id,
                    user_ref,
                }, desired_user_id));
                continue;
            }

            const same_user = desired_user_id !== undefined && stored.user_id === desired_user_id;
            const same_name = stored.telegram_username === link.telegram_username;
            const same_chat = stored.private_chat_id === link.private_chat_id;
            if (same_user && same_name && same_chat) {
                this.bindings.push({
                    action: "unchanged",
                    telegram_id: link.telegram_id,
                    telegram_username: link.telegram_username,
                    private_chat_id: link.private_chat_id,
                    user_ref,
                });
                this.records.push(binding_record({
                    action: "unchanged",
                    telegram_id: link.telegram_id,
                    telegram_username: link.telegram_username,
                    private_chat_id: link.private_chat_id,
                    user_ref,
                }, desired_user_id));
                continue;
            }

            const binding: PlannedBinding = {
                action: "update",
                telegram_id: link.telegram_id,
                telegram_username: link.telegram_username,
                private_chat_id: link.private_chat_id,
                user_ref,
                previous_user_id: stored.user_id,
            };
            this.bindings.push(binding);
            this.records.push(binding_record(binding, desired_user_id));
        }
    }

    private drop_binding_conflicts(links: Map<string, BindingLink>): BindingLink[] {
        const ids_by_user = new Map<string, Set<number>>();
        const users_by_id = new Map<number, Set<string>>();
        for (const link of links.values()) {
            const ids = ids_by_user.get(link.telegram_username) ?? new Set<number>();
            ids.add(link.telegram_id);
            ids_by_user.set(link.telegram_username, ids);
            const names = users_by_id.get(link.telegram_id) ?? new Set<string>();
            names.add(link.telegram_username);
            users_by_id.set(link.telegram_id, names);
        }

        const runtime_names = new Set(this.input.runtime_telegram_users.map((user) => user.tgid));
        const mismatched_users = new Set<string>();
        for (const [username, ids] of ids_by_user) {
            if (ids.size <= 1) {
                continue;
            }
            mismatched_users.add(username);
            this.records.push({
                status: "conflict",
                source: runtime_names.has(username) ? "runtime" : "telegram_users",
                category: "chat_id_mismatch",
                key: username_key(username),
                message: `chat ids ${[...ids].join(", ")}`,
            });
        }

        const colliding_ids = new Set<number>();
        for (const [telegram_id, names] of users_by_id) {
            if (names.size <= 1) {
                continue;
            }
            colliding_ids.add(telegram_id);
            const from_runtime = [...names].some((name) => runtime_names.has(name));
            this.records.push({
                status: "conflict",
                source: from_runtime ? "runtime" : "telegram_users",
                category: "telegram_id_collision",
                key: `telegram_id=${telegram_id}`,
                message: `claimed by ${[...names].map((name) => `@${name}`).join(", ")}`,
            });
        }

        const kept: BindingLink[] = [];
        for (const link of links.values()) {
            if (mismatched_users.has(link.telegram_username) || colliding_ids.has(link.telegram_id)) {
                continue;
            }
            kept.push(link);
        }
        return kept;
    }

    private legacy_index(): Map<string, PlannedUser[]> {
        const index = new Map<string, PlannedUser[]>();
        for (const user of this.users) {
            if (user.source !== "sheet") {
                continue;
            }
            const hash = legacy_system_id(user.name, user.surname);
            const hits = index.get(hash) ?? [];
            hits.push(user);
            index.set(hash, hits);
        }
        return index;
    }

    private firestore_duplicate(username: string): boolean {
        return this.records.some((record) =>
            record.category === "duplicate_tgid"
            && record.source === "setup"
            && record.key === username_key(username));
    }

    private user_from_sheet(row: UserData, existing: UserData | undefined): PlannedUser {
        if (existing) {
            return {
                action: "unchanged",
                source: "sheet",
                tg_username: row.id.tg_username ?? "",
                system_id: existing.id.system_id,
                name: existing.name,
                surname: existing.surname,
                lang: existing.lang,
                voice: existing.voice,
                roles: existing.roles,
                runtime_only: false,
            };
        }
        return {
            action: "create",
            source: "sheet",
            tg_username: row.id.tg_username ?? "",
            name: row.name,
            surname: row.surname,
            lang: row.lang,
            voice: row.voice,
            roles: row.roles,
            runtime_only: false,
        };
    }

    private user_from_runtime(username: string, existing: UserData | undefined): PlannedUser {
        if (existing) {
            return {
                action: "unchanged",
                source: "runtime",
                tg_username: username,
                system_id: existing.id.system_id,
                name: existing.name,
                surname: existing.surname,
                lang: existing.lang,
                voice: existing.voice,
                roles: existing.roles,
                runtime_only: true,
            };
        }
        return {
            action: "create",
            source: "runtime",
            tg_username: username,
            name: "",
            surname: "",
            lang: Language.EN,
            voice: Voice.Unknown,
            roles: [],
            runtime_only: true,
        };
    }
}

function new_user_data(user: PlannedUser): NewUserData {
    return {
        name: user.name,
        surname: user.surname,
        lang: user.lang,
        voice: user.voice,
        roles: [...user.roles],
        tg_username: user.tg_username,
    };
}

function user_ref_for(user: PlannedUser): PlannedUserRef {
    if (user.system_id) {
        return { kind: "system_id", system_id: user.system_id };
    }
    return { kind: "username", tg_username: user.tg_username };
}

function resolve_user_ref(
    ref: PlannedUserRef,
    assigned: ReadonlyMap<string, string>,
): string | undefined {
    if (ref.kind === "system_id") {
        return ref.system_id;
    }
    return assigned.get(ref.tg_username);
}

function user_record(user: PlannedUser, system_id: string | undefined): PlanRecord {
    const runtime_note = user.runtime_only ? ", runtime-only, no additional permissions" : "";
    if (user.action === "unchanged" && system_id) {
        return {
            status: "unchanged",
            source: user.source,
            key: username_key(user.tg_username),
            message: `system_id=${system_id}${runtime_note}`,
        };
    }
    if (system_id) {
        return {
            status: "created",
            source: user.source,
            key: username_key(user.tg_username),
            message: `system_id=${system_id}${runtime_note}`,
        };
    }
    const who = `${user.name} ${user.surname}`.trim();
    return {
        status: "created",
        source: user.source,
        key: username_key(user.tg_username),
        message: who.length > 0 ? `create ${who}${runtime_note}` : `create${runtime_note}`,
    };
}

function binding_record(binding: PlannedBinding, system_id: string | undefined): PlanRecord {
    const key = binding_key(binding.telegram_username, binding.telegram_id);
    const target = system_id ?? `pending @${binding.telegram_username}`;
    if (binding.action === "unchanged") {
        return {
            status: "unchanged",
            source: "telegram_users",
            key,
            message: `user_id=${target}`,
        };
    }
    if (binding.action === "create") {
        return {
            status: "created",
            source: "telegram_users",
            key,
            message: `user_id=${target}`,
        };
    }
    return {
        status: "updated",
        source: "telegram_users",
        key,
        message: `user_id ${binding.previous_user_id ?? "?"} -> ${target}`,
    };
}

function username_key(username: string): string {
    return `@${username}`;
}

function binding_key(username: string, telegram_id: number): string {
    return `@${username} telegram_id=${telegram_id}`;
}

function link_key(telegram_id: number, username: string): string {
    return `${telegram_id}\0${username}`;
}

function links_for_telegram_id(
    links: Map<string, BindingLink>,
    telegram_id: number,
): BindingLink[] {
    const found: BindingLink[] = [];
    for (const link of links.values()) {
        if (link.telegram_id === telegram_id) {
            found.push(link);
        }
    }
    return found;
}

function identity_key(verbatim: string): string {
    return verbatim.replace(/^@+/, "").toLowerCase();
}

// Old UserService keyed roster rows by sha256(name + NUL + surname).
function legacy_system_id(name: string, surname: string): string {
    return crypto.createHash("sha256").update(`${name}\0${surname}`).digest("hex");
}
