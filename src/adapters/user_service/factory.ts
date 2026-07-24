import { UsersStorageConfig, UsersStorageFactory } from "@src/adapters/users_storage/factory.js";
import { UserService } from "@src/components/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — UserService is instantiated in-process on top of IUsersStorage.
export type UserServiceConfigJson = {
    type: "local";
    storage: UsersStorageConfig;
    fetch_interval_sec: number;
}

export class UserServiceConfig {
    constructor(private readonly json: UserServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get storage(): UsersStorageConfig {
        return this.json.storage;
    }

    get fetch_interval_sec(): number {
        return this.json.fetch_interval_sec;
    }

    verify(): Status {
        if (!this.json.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (this.json.type !== "local") {
            return Expected.err("'type' MUST be: local");
        }
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

export class UserServiceFactory {
    static create(config: UserServiceConfig, parent_journal: Journal): Expected<UserService> {
        switch (config.type) {
            case "local": {
                const storage_status = UsersStorageFactory.create(config.storage, parent_journal);
                if (!storage_status.ok) {
                    return storage_status.wrap_error("can't create users storage");
                }
                return Expected.ok(new UserService(
                    storage_status.value,
                    config.fetch_interval_sec,
                    parent_journal,
                ));
            }
        }
    }
}
