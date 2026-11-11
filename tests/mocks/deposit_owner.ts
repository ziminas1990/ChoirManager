import { IDepositOwnerAgent } from "@src/interfaces/user_agent.js";

import { unexpected } from "./unexpected.js";

export function mock_deposit_owner(overrides: Partial<IDepositOwnerAgent> = {}): IDepositOwnerAgent {
    return {
        base: unexpected,
        send_deposit_info: unexpected,
        send_deposit_changes: unexpected,
        send_already_paid_response: unexpected,
        send_membership_reminder: unexpected,
        send_thanks_for_information: unexpected,
        send_transactions_info: unexpected,
        ...overrides,
    };
}
