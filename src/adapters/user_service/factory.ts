import {
    UsersStorageConfig,
    UsersStorageFactory,
} from "@src/adapters/users_storage/factory.js";
import { UserService } from "@src/components/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — UserService is instantiated in-process on top of ICollection.
export type UserServiceConfigJson = {
    type: "local";
    storage: UsersStorageConfig;
}

export class UserServiceConfig {
    constructor(private readonly json: UserServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get storage(): UsersStorageConfig {
        return this.json.storage;
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
        return Expected.ok(undefined);
    }
}

export class UserServiceFactory {
    static create(config: UserServiceConfig, parent_journal: Journal): Expected<UserService> {
        switch (config.type) {
            case "local": {
                const storage_status = UsersStorageFactory.create(
                    config.storage,
                    parent_journal,
                );
                if (!storage_status.ok) {
                    return storage_status.wrap_error("can't create users collection");
                }
                return Expected.ok(new UserService(
                    storage_status.value,
                    parent_journal,
                ));
            }
        }
    }
}
