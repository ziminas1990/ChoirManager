import crypto from "crypto";

import { UserData, UserId } from "@src/entities/user.js";
import { IUsersStorage } from "@src/interfaces/storage/users_storage.js";
import { IUserService } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";


export class UserService implements IUserService {
    private readonly journal: Journal;
    // system_id -> user
    private users = new Map<string, UserData>();
    private by_telegram_id = new Map<string, UserData>();
    private last_fetch_date?: Date;

    constructor(
        private readonly storage: IUsersStorage,
        private readonly fetch_interval_sec: number,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("user_service");
    }

    async init(): Promise<Status> {
        return await this.refetch();
    }

    async proceed(): Promise<Status> {
        if (!Helpers.time_to_refetch(this.last_fetch_date, this.fetch_interval_sec)) {
            return Expected.ok(undefined);
        }
        return await this.refetch();
    }

    async fetch_all(): Promise<UserData[]> {
        return Array.from(this.users.values());
    }

    async resolve_user(user_id: Partial<UserId>): Promise<Expected<UserData | undefined>> {
        if (!user_id.system_id && !user_id.telegram_id) {
            return Expected.err("at least one of system_id or telegram_id must be provided");
        }
        if (user_id.system_id && user_id.telegram_id) {
            return Expected.err("when system_id is provided, other UserId fields must be empty");
        }

        if (user_id.system_id) {
            return Expected.ok(this.users.get(user_id.system_id));
        }
        return Expected.ok(this.by_telegram_id.get(user_id.telegram_id!));
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

            next_users.set(system_id, user);
            if (telegram_id) {
                next_by_telegram_id.set(telegram_id, user);
            }
        }

        this.users = next_users;
        this.by_telegram_id = next_by_telegram_id;
        this.last_fetch_date = new Date();

        this.journal.log().info({ users_count: this.users.size }, "Users cache refreshed");
        return Expected.ok(undefined);
    }
}

class Helpers {
    static system_id_from_name(name: string, surname: string): string {
        return crypto.createHash("sha256").update(`${name}\0${surname}`).digest("hex");
    }

    static time_to_refetch(last_fetch_date: Date | undefined, fetch_interval_sec: number): boolean {
        if (!last_fetch_date) {
            return true;
        }
        const fetch_interval_ms = fetch_interval_sec * 1000;
        return Date.now() - last_fetch_date.getTime() >= fetch_interval_ms;
    }
}
