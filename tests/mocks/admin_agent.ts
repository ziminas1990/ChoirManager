import { IAdminAgent } from "@src/interfaces/user_agent.js";

import { unexpected } from "./unexpected.js";

export function mock_admin_agent(overrides: Partial<IAdminAgent> = {}): IAdminAgent {
    return {
        base: unexpected,
        send_notification: unexpected,
        send_runtime_backup: unexpected,
        send_logs: unexpected,
        ...overrides,
    };
}
