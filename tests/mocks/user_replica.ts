import { IUserServiceReplica } from "@src/interfaces/user_service.js";

import { unexpected } from "./unexpected.js";

export function mock_user_replica(overrides: Partial<IUserServiceReplica> = {}): IUserServiceReplica {
    return {
        sync: unexpected,
        fetch_all: unexpected,
        find: unexpected,
        resolve_user: unexpected,
        ...overrides,
    };
}
