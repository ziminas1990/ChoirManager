import { AdministrationService } from "@src/components/administration_service.js";
import { IUserService } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

// "local" — AdministrationService is instantiated in-process. Pending operations
// are ephemeral (no storage).
export type AdministrationServiceConfigJson = {
    type: "local";
    confirmation_ttl_sec: number;
    max_pending_per_user: number;
}

export class AdministrationServiceConfig {
    constructor(private readonly json: AdministrationServiceConfigJson) {}

    get type(): "local" {
        return this.json.type;
    }

    get confirmation_ttl_sec(): number {
        return this.json.confirmation_ttl_sec;
    }

    get max_pending_per_user(): number {
        return this.json.max_pending_per_user;
    }

    verify(): Status {
        if (!this.json.type) {
            return Expected.err("'type' MUST be specified");
        }
        if (this.json.type !== "local") {
            return Expected.err("'type' MUST be: local");
        }

        if (this.json.confirmation_ttl_sec == undefined) {
            return Expected.err("'confirmation_ttl_sec' MUST be specified");
        }
        if (!Number.isInteger(this.json.confirmation_ttl_sec) || this.json.confirmation_ttl_sec <= 0) {
            return Expected.err("'confirmation_ttl_sec' MUST be a positive integer");
        }

        if (this.json.max_pending_per_user == undefined) {
            return Expected.err("'max_pending_per_user' MUST be specified");
        }
        if (!Number.isInteger(this.json.max_pending_per_user) || this.json.max_pending_per_user <= 0) {
            return Expected.err("'max_pending_per_user' MUST be a positive integer");
        }

        return Expected.ok(undefined);
    }
}

export class AdministrationServiceFactory {
    static create(
        config: AdministrationServiceConfig,
        users: IUserService,
        parent_journal: Journal,
    ): Expected<AdministrationService> {
        switch (config.type) {
            case "local": {
                return Expected.ok(new AdministrationService(
                    config.confirmation_ttl_sec,
                    config.max_pending_per_user,
                    users,
                    parent_journal,
                ));
            }
        }
    }
}
