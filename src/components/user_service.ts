import crypto from "crypto";

import { Language, Role, UserData, UserId, Voice } from "@src/entities/user.js";
import { IUsersStorage } from "@src/interfaces/storage/users_storage.js";
import { IUserService, IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";


export class UserService extends Logic<void> implements IUserService {
    private readonly journal: Journal;
    // system_id -> user
    private users = new Map<string, UserData>();
    private by_telegram_id = new Map<string, UserData>();
    // telegram_id -> guest (not present in storage)
    private guests = new Map<string, UserData>();

    constructor(
        private readonly storage: IUsersStorage,
        fetch_interval_sec: number,
        parent_journal: Journal,
    ) {
        super(fetch_interval_sec * 1000);
        this.journal = parent_journal.child("user_service");
    }

    async init(): Promise<Status> {
        return await this.refetch();
    }

    async fetch_all(): Promise<UserData[]> {
        return Array.from(this.users.values());
    }

    async resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>> {
        return this.resolve_from_cache(user_id);
    }

    async create_guest(telegram_id: string): Promise<UserData> {
        const existing = this.by_telegram_id.get(telegram_id) ?? this.guests.get(telegram_id);
        if (existing) {
            return existing;
        }

        const guest: UserData = {
            id: {
                system_id: Helpers.system_id_from_name("guest", telegram_id),
                telegram_id,
            },
            name: "",
            surname: "",
            lang: Language.EN,
            voice: Voice.Unknown,
            roles: [Role.Guest],
        };
        this.guests.set(telegram_id, guest);
        this.journal.log().info(`Created guest user ${telegram_id}`);
        return guest;
    }

    // Sync local-cache view for in-process wiring (Runtime, etc.).
    // Not part of IUserService — remote implementations will not have this.
    as_replica(): IUserServiceReplica {
        return {
            fetch_all: () => Array.from(this.users.values()),
            resolve_user: (user_id) => this.resolve_from_cache(user_id),
            sync: () => this.refetch(),
        };
    }

    protected async proceed_impl(_now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        const status = await this.refetch();
        if (!status.ok) {
            return status.cast_error<void[]>();
        }
        return Expected.ok([]);
    }

    private resolve_from_cache(user_id: Partial<UserId>): Expected<UserData | undefined> {
        if (!user_id.system_id && !user_id.telegram_id) {
            return Expected.err("at least one of system_id or telegram_id must be provided");
        }
        if (user_id.system_id && user_id.telegram_id) {
            return Expected.err("when system_id is provided, other UserId fields must be empty");
        }

        if (user_id.system_id) {
            return Expected.ok(this.users.get(user_id.system_id));
        }

        const telegram_id = user_id.telegram_id!;
        return Expected.ok(
            this.by_telegram_id.get(telegram_id) ?? this.guests.get(telegram_id)
        );
    }

    private async refetch(): Promise<Status> {
        let fetched: UserData[];
        try {
            fetched = await this.storage.fetch_all();
        } catch (e) {
            return Expected.exception("can't fetch users", e);
        }

        const next_users = new Map<string, UserData>();
        const next_by_telegram_id = new Map<string, UserData>();

        for (const raw of fetched) {
            const system_id = raw.id.system_id || Helpers.system_id_from_name(raw.name, raw.surname);
            const telegram_id = raw.id.telegram_id;

            if (next_users.has(system_id)) {
                this.journal.log().warn(`Duplicate system_id '${system_id}', keeping first`);
                continue;
            }
            if (telegram_id && next_by_telegram_id.has(telegram_id)) {
                this.journal.log().warn(`Duplicate telegram_id '${telegram_id}', keeping first`);
                continue;
            }

            const user: UserData = {
                ...raw,
                id: {
                    system_id,
                    ...(telegram_id ? { telegram_id } : {}),
                },
            };

            const existing = this.users.get(system_id);
            if (existing) {
                const diffs = Helpers.diff_user(existing, user);
                if (diffs.length > 0) {
                    const label = telegram_id ?? system_id;
                    this.journal.log().info(`Updated user ${label}: ${diffs.join(", ")}`);
                }
            }

            next_users.set(system_id, user);
            if (telegram_id) {
                next_by_telegram_id.set(telegram_id, user);
                this.guests.delete(telegram_id);
            }
        }

        this.users = next_users;
        this.by_telegram_id = next_by_telegram_id;

        this.journal.log().info({ users_count: this.users.size }, "Users cache refreshed");
        return Expected.ok(undefined);
    }
}

class Helpers {
    static system_id_from_name(name: string, surname: string): string {
        return crypto.createHash("sha256").update(`${name}\0${surname}`).digest("hex");
    }

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
        if (prev.id.telegram_id != next.id.telegram_id) {
            diffs.push(`telegram_id: ${prev.id.telegram_id} -> ${next.id.telegram_id}`);
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
