import { IUserAgent } from "@src/interfaces/user_agent.js";

import { unexpected } from "./unexpected.js";

export function mock_user_agent(overrides: Partial<IUserAgent> = {}): IUserAgent {
    return {
        agent_name: unexpected,
        userid: unexpected,
        send_message: unexpected,
        send_file: unexpected,
        ask_confirmation: unexpected,
        proceed: unexpected,
        as_chorister: unexpected,
        as_deposit_owner: unexpected,
        as_accounter: unexpected,
        as_admin: unexpected,
        ...overrides,
    };
}
