import { IChorister } from "@src/interfaces/user_agent.js";

import { unexpected } from "./unexpected.js";

export function mock_chorister(overrides: Partial<IChorister> = {}): IChorister {
    return {
        base: unexpected,
        send_scores_list: unexpected,
        on_feedback_received: unexpected,
        ...overrides,
    };
}
