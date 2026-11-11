import { IUserService } from "@src/interfaces/user_service.js";

import { unexpected } from "./unexpected.js";

export function mock_user_service(overrides: Partial<IUserService> = {}): IUserService {
    return {
        fetch_all: unexpected,
        find: unexpected,
        resolve_user: unexpected,
        resolve_or_create: unexpected,
        create: unexpected,
        update: unexpected,
        ...overrides,
    };
}
