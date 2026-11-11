import { ISimpleMemoryService } from "@src/interfaces/simple_memory_service.js";

import { unexpected } from "./unexpected.js";

export function mock_simple_memory(overrides: Partial<ISimpleMemoryService> = {}): ISimpleMemoryService {
    return {
        init: unexpected,
        remember: unexpected,
        forget: unexpected,
        update: unexpected,
        list: unexpected,
        get: unexpected,
        search: unexpected,
        ask: unexpected,
        ...overrides,
    };
}
