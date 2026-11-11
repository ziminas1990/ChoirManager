import { IAccounterAgent } from "@src/interfaces/user_agent.js";

import { unexpected } from "./unexpected.js";

export function mock_accounter(overrides: Partial<IAccounterAgent> = {}): IAccounterAgent {
    return {
        base: unexpected,
        send_already_paid_notification: unexpected,
        send_top_up_notification: unexpected,
        mirror_deposit_changes: unexpected,
        mirror_reminder: unexpected,
        ...overrides,
    };
}
