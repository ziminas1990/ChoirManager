import { Expected, Status } from "@src/utils/expected.js";
import { UsersStorageConfig, UsersStorageFactory } from "@src/adapters/users_storage/factory.js";
import { Database, User } from '@src/database.js';
import { UserData } from '@src/entities/user.js';
import { IUsersStorage } from '@src/interfaces/storage/users_storage.js';
import { Journal } from '@src/journal';

export type UsersFetcherConfigJson = {
    storage: UsersStorageConfig;
    fetch_interval_sec: number;
}

export class UsersFetcherConfig {
    constructor(private readonly json: UsersFetcherConfigJson) {}

    get storage(): UsersStorageConfig {
        return this.json.storage;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    verify(): Status {
        if (!this.json.storage) {
            return Expected.err("'storage' MUST be specified");
        }
        const storage_status = UsersStorageFactory.verify(this.json.storage);
        if (!storage_status.ok) {
            return storage_status.wrap_error("'storage' misconfiguration");
        }
        if (!this.json.fetch_interval_sec) {
            return Expected.err("'fetch_interval_sec' MUST be specified");
        }
        if (this.json.fetch_interval_sec < 10) {
            return Expected.err("'fetch_interval_sec' MUST be at least 10 seconds");
        }
        return Expected.ok(undefined);
    }
}

function user_from_data(data: UserData): User | undefined {
    if (!data.id.telegram_id) {
        return undefined;
    }
    return new User(
        data.id.telegram_id,
        data.name,
        data.surname,
        data.lang,
        data.voice,
        data.roles,
    );
}

export class UsersFetcher {
    private last_fetch_date?: Date;
    private journal: Journal;

    constructor(
        private readonly storage: IUsersStorage,
        private readonly fetch_interval_sec: number,
        private database: Database,
        parent_journal: Journal
    ) {
        this.journal = parent_journal.child("users_fetcher");
    }

    async start(): Promise<Status> {
        return await this.proceed();
    }

    async proceed(): Promise<Status> {
        if (!this.time_to_fetch()) {
            return Expected.ok(undefined);
        }

        let users_data: UserData[];
        try {
            users_data = await this.storage.fetch_all();
        } catch (e) {
            return Expected.exception("can't fetch users", e);
        }

        for (const data of users_data) {
            const user = user_from_data(data);
            if (user) {
                this.update_database(user);
            }
        }
        return Expected.ok(undefined);
    }

    private update_database(user: User): void {
        const existing_user = this.database.get_user(user.tgid);
        if (existing_user == undefined) {
            this.database.add_user(user);
        } else {
            const diffs = existing_user.update(user);
            if (diffs.length > 0) {
                this.journal.log().info(`Updated user ${user.tgid}: ${diffs.join(", ")}`);
            }
        }
    }

    // Check if it is time to fetch data since previous check.
    // NOTE: if function returns true, last_fetch_date is set to current time.
    private time_to_fetch(): boolean {
        const now_ms = new Date().getTime();
        if (!this.last_fetch_date) {
            this.last_fetch_date = new Date();
            return true;
        }
        const fetch_interval_ms = this.fetch_interval_sec * 1000;
        const time_since_last_fetch = now_ms - this.last_fetch_date.getTime();
        if (time_since_last_fetch < fetch_interval_ms) {
            return false;
        }
        this.last_fetch_date = new Date();
        return true;
    }
}
