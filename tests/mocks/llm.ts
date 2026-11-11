import { ILLM } from "@src/interfaces/llm.js";

import { unexpected } from "./unexpected.js";

export function mock_llm(overrides: Partial<ILLM> = {}): ILLM {
    return {
        generate_response: unexpected,
        generate_stream_response: unexpected,
        ...overrides,
    };
}
