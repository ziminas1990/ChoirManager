import { ICollection } from "@src/interfaces/collection.js";

import { unexpected } from "./unexpected.js";

export function mock_collection<T, P>(overrides: Partial<ICollection<T, P>> = {}): ICollection<T, P> {
    return {
        proceed: unexpected, create: unexpected, get_or_create: unexpected,
        get_one: unexpected, get_many: unexpected, get_all: unexpected,
        update: unexpected, delete: unexpected, supports: unexpected,
        ...overrides,
    };
}
