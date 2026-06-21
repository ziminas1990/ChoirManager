import { z } from "zod";

import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Journal } from "@src/journal.js";
import { DepositActions } from "@src/use_cases/deposit_actions.js";
import { Expected } from "@src/utils/expected.js";
import { empty_parameters_schema, parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success, status_to_expected } from "./tool_response.js";

const deposit_manager_top_up_schema = z.object({
    amount: z.number().finite().describe("Amount deposited by the user."),
    original_message: z.string().trim().min(1).describe("Original user message that reported the deposit."),
}).strict();

const deposit_manager_send_transactions_schema = z.object({
    limit: z.number().optional().describe("Optional max number of transactions to show."),
}).strict();

export class DepositManagerTools implements IToolchain {
    constructor(
        private user: TelegramUser,
        private journal: Journal,
    ) {}

    get_name(): string {
        return "deposit_manager";
    }

    get_readme(): string {
        return [
            "Tools for deposit and membership fee operations.",
            "Use deposit_manager_top_up when user reports a new deposit with amount.",
            "Use deposit_manager_already_paid only when user says they already paid and does not provide a new amount/date.",
        ].join("\n");
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["deposit_manager_send_deposit_info", tool_from_schema(
                "deposit_manager_send_deposit_info",
                "Send the user their current deposit and membership info.",
                empty_parameters_schema,
            )],
            ["deposit_manager_already_paid", tool_from_schema(
                "deposit_manager_already_paid",
                [
                    "Does two things:",
                    "1. sends a message to the user that notification is received",
                    "2. notifies the system that user said they already paid the deposit/membership fee",
                ].join("\n"),
                empty_parameters_schema,
            )],
            ["deposit_manager_top_up", tool_from_schema(
                "deposit_manager_top_up",
                [
                    "Does two things:",
                    "1. sends a message to the user that notification is received",
                    "2. notifies the system that user deposited money",
                ].join("\n"),
                deposit_manager_top_up_schema,
            )],
            ["deposit_manager_send_transactions", tool_from_schema(
                "deposit_manager_send_transactions",
                "Send the user their transaction history.",
                deposit_manager_send_transactions_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name === "deposit_manager_send_deposit_info") {
            const parsed = parse_tool_parameters(empty_parameters_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await DepositActions.deposit_requested(this.user, this.journal);
            return status_to_expected(status, return_success(true));
        }

        if (name === "deposit_manager_already_paid") {
            const parsed = parse_tool_parameters(empty_parameters_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await DepositActions.already_paid(this.user, this.journal);
            return status_to_expected(status, return_success(true));
        }

        if (name === "deposit_manager_top_up") {
            const parsed = parse_tool_parameters(deposit_manager_top_up_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await DepositActions.top_up(
                this.user,
                parsed.value.amount,
                parsed.value.original_message,
                this.journal,
            );
            return status_to_expected(status, return_success(true));
        }

        if (name === "deposit_manager_send_transactions") {
            const parsed = parse_tool_parameters(deposit_manager_send_transactions_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await DepositActions.transactions_requested(
                this.user,
                this.journal,
                parsed.value.limit,
            );
            return status_to_expected(status, return_success(true));
        }

        return Expected.err(return_error(`Unknown tool: ${name}`));
    }
}
