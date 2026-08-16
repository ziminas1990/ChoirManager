import crypto from "crypto";

import { Language, Role, UserData, UserId, user_has_role, Voice } from "@src/entities/user.js";
import { ICollection } from "@src/interfaces/collection.js";
import {
    IUserService,
    IUserServiceReplica,
    NewUserData,
    UserPatch,
} from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";


export class UserService implements IUserService {
    private readonly journal: Journal;
    // Includes guests. fetch_all() filters them out.
    private by_system_id = new Map<string, UserData>();
    private by_tg_username = new Map<string, UserData>();

    constructor(
        private readonly collection: ICollection<UserData, UserPatch>,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("user_service");
    }

    async init(): Promise<Status> {
        return await this.hydrate();
    }

    async fetch_all(): Promise<UserData[]> {
        return this.registered_users();
    }

    async resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>> {
        return this.resolve_from_cache(user_id);
    }

    async create_guest(tg_username?: string): Promise<Expected<UserData>> {
        const username = this.optional_username(tg_username);
        if (username) {
            const existing = this.by_tg_username.get(username);
            if (existing) {
                return Expected.ok(existing);
            }
        }

        const guest: UserData = {
            id: {
                system_id: crypto.randomUUID(),
                ...(username ? { tg_username: username } : {}),
            },
            name: "",
            surname: "",
            lang: Language.EN,
            voice: Voice.Unknown,
            roles: [Role.Guest],
        };

        const persisted = await this.persist_new(guest);
        if (!persisted.ok) {
            return persisted.wrap_error("can't create guest");
        }

        const label = username ?? persisted.value.id.system_id;
        this.journal.log().info(`Created guest user ${label}`);
        return persisted;
    }

    async create(user: NewUserData): Promise<Expected<UserData>> {
        const username = this.optional_username(user.tg_username);
        if (username && this.username_in_use(username)) {
            return Expected.err(`tg_username '${username}' is already used`);
        }
        if (user.roles.includes(Role.Guest)) {
            return Expected.err("create() cannot assign guest; use create_guest()");
        }

        const created: UserData = {
            id: {
                system_id: crypto.randomUUID(),
                ...(username ? { tg_username: username } : {}),
            },
            name: user.name,
            surname: user.surname,
            lang: user.lang,
            voice: user.voice,
            roles: user.roles,
        };

        const persisted = await this.persist_new(created);
        if (!persisted.ok) {
            return persisted.wrap_error("can't create user");
        }

        const label = username ?? persisted.value.id.system_id;
        this.journal.log().info(`Created user ${label}`);
        return persisted;
    }

    async update(system_id: string, patch: UserPatch): Promise<Expected<UserData>> {
        const existing = this.by_system_id.get(system_id);
        if (!existing) {
            return Expected.err(`user '${system_id}' not found`);
        }

        const username = patch.tg_username !== undefined
            ? this.optional_username(patch.tg_username)
            : undefined;
        if (patch.tg_username !== undefined && !username) {
            return Expected.err("tg_username must be non-empty when set");
        }
        if (username && this.username_in_use(username, system_id)) {
            return Expected.err(`tg_username '${username}' is already used`);
        }

        const stored = await this.collection.update(system_id, patch);
        if (!stored.ok) {
            return stored.wrap_error("can't update user");
        }

        this.remember(stored.value);
        const diffs = Helpers.diff_user(existing, stored.value);
        if (diffs.length > 0) {
            const label = stored.value.id.tg_username ?? system_id;
            this.journal.log().info(`Updated user ${label}: ${diffs.join(", ")}`);
        }
        return stored;
    }

    // Sync local-cache view for in-process wiring (Runtime, etc.).
    // Not part of IUserService — remote implementations will not have this.
    as_replica(): IUserServiceReplica {
        return {
            fetch_all: () => this.registered_users(),
            resolve_user: (user_id) => this.resolve_from_cache(user_id),
            sync: () => this.hydrate(),
        };
    }

    async proceed(now: Date): Promise<Status> {
        try {
            await this.collection.proceed(now);
            return Expected.ok(undefined);
        } catch (e) {
            return Expected.exception("can't proceed users collection", e);
        }
    }

    private resolve_from_cache(user_id: Partial<UserId>): Expected<UserData | undefined> {
        if (!user_id.system_id && !user_id.tg_username) {
            return Expected.err("at least one of system_id or tg_username must be provided");
        }
        if (user_id.system_id && user_id.tg_username) {
            return Expected.err("when system_id is provided, other UserId fields must be empty");
        }

        if (user_id.system_id) {
            return Expected.ok(this.by_system_id.get(user_id.system_id));
        }

        return Expected.ok(this.by_tg_username.get(user_id.tg_username!));
    }

    private async hydrate(): Promise<Status> {
        const fetched = await this.collection.get_all();
        if (!fetched.ok) {
            return fetched.wrap_error("can't fetch users");
        }

        const next_by_system_id = new Map<string, UserData>();
        const next_by_tg_username = new Map<string, UserData>();

        for (const user of fetched.value) {
            if (next_by_system_id.has(user.id.system_id)) {
                this.journal.log().warn(`Duplicate system_id '${user.id.system_id}', keeping first`);
                continue;
            }

            const username = user.id.tg_username;
            if (username && next_by_tg_username.has(username)) {
                this.journal.log().warn(`Duplicate tg_username '${username}', keeping first`);
                continue;
            }

            const existing = this.by_system_id.get(user.id.system_id);
            if (existing) {
                const diffs = Helpers.diff_user(existing, user);
                if (diffs.length > 0) {
                    const label = username ?? user.id.system_id;
                    this.journal.log().info(`Updated user ${label}: ${diffs.join(", ")}`);
                }
            }

            next_by_system_id.set(user.id.system_id, user);
            if (username) {
                next_by_tg_username.set(username, user);
            }
        }

        this.by_system_id = next_by_system_id;
        this.by_tg_username = next_by_tg_username;

        const users_count = this.registered_users().length;
        this.journal.log().info({
            users_count,
            guests_count: this.by_system_id.size - users_count,
        }, "Users cache refreshed");
        return Expected.ok(undefined);
    }

    private async persist_new(user: UserData): Promise<Expected<UserData>> {
        const stored = await this.collection.create(user);
        if (!stored.ok) {
            return stored;
        }
        this.remember(stored.value);
        return stored;
    }

    private remember(user: UserData): void {
        const previous = this.by_system_id.get(user.id.system_id);
        if (previous?.id.tg_username && previous.id.tg_username !== user.id.tg_username) {
            const mapped = this.by_tg_username.get(previous.id.tg_username);
            if (mapped?.id.system_id === user.id.system_id) {
                this.by_tg_username.delete(previous.id.tg_username);
            }
        }

        this.by_system_id.set(user.id.system_id, user);
        if (user.id.tg_username) {
            this.by_tg_username.set(user.id.tg_username, user);
        }
    }

    private username_in_use(tg_username: string, except_system_id?: string): boolean {
        const existing = this.by_tg_username.get(tg_username);
        return existing != undefined && existing.id.system_id !== except_system_id;
    }

    private registered_users(): UserData[] {
        return Array.from(this.by_system_id.values())
            .filter((user) => !user_has_role(user, Role.Guest));
    }

    private optional_username(tg_username?: string): string | undefined {
        if (!tg_username || tg_username.length === 0) {
            return undefined;
        }
        return tg_username;
    }
}

class Helpers {
    static diff_user(prev: UserData, next: UserData): string[] {
        const diffs: string[] = [];
        if (prev.name != next.name) {
            diffs.push(`name: ${prev.name} -> ${next.name}`);
        }
        if (prev.surname != next.surname) {
            diffs.push(`surname: ${prev.surname} -> ${next.surname}`);
        }
        if (prev.lang != next.lang) {
            diffs.push(`lang: ${prev.lang} -> ${next.lang}`);
        }
        if (prev.voice != next.voice) {
            diffs.push(`voice: ${prev.voice} -> ${next.voice}`);
        }
        if (prev.id.tg_username != next.id.tg_username) {
            diffs.push(`tg_username: ${prev.id.tg_username} -> ${next.id.tg_username}`);
        }

        for (const granted_role of next.roles) {
            if (!prev.roles.includes(granted_role)) {
                diffs.push(`granted role: ${granted_role}`);
            }
        }
        for (const revoked_role of prev.roles) {
            if (!next.roles.includes(revoked_role)) {
                diffs.push(`revoked role: ${revoked_role}`);
            }
        }
        return diffs;
    }
}
