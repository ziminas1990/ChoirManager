import { Expected, Status } from "@src/utils/expected.js";
import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { Score } from "@src/entities/score.js";
import { UserData } from "@src/entities/user.js";
import { Feedback } from "@src/entities/feedback.js";
import { Transaction } from "./transactions_storage.js";

// ask_confirmation failures a caller can distinguish from other prompt errors.
export enum ConfirmationError {
    TimedOut = 1,
}

// Omitted format uses ordinary HTML; rich_html supports tables and embedded controls.
// Omitted reply_markup leaves keyboard behavior to the messaging platform.
export type SendMessageOptions = {
    format?: "html" | "rich_html";
    reply_markup?: {
        inline_keyboard: { text: string; callback_data?: string; url?: string }[][];
    } | {
        keyboard: { text: string }[][];
        is_persistent?: boolean;
        resize_keyboard?: boolean;
    };
};

// Omitted format uses ordinary HTML. Omitted inline_keyboard preserves controls;
// an empty inline_keyboard removes them. Omit text for keyboard-only edits.
export type EditMessageOptions = {
    text?: string;
    format?: "html" | "rich_html";
    inline_keyboard?: { text: string; callback_data?: string; url?: string }[][];
};

export interface IUserAgent
{
    agent_name(): string;

    // Canonical identity: UserData.id.system_id, not telegram username.
    userid(): string;

    send_message(message: string, options?: SendMessageOptions): Promise<Expected<number>>;

    edit_message(message_id: number, options: EditMessageOptions): Promise<Status>;

    send_file(filename: string, caption?: string, content_type?: string): Promise<Status>;

    // Ask a yes/no question. Button labels default to "yes" / "no".
    // Optional `lifetime_sec` expires unanswered prompts as an error.
    ask_confirmation(
        question: string,
        positive?: string,
        negative?: string,
        lifetime_sec?: number,
    ): Promise<Expected<"positive" | "negative">>;

    proceed(now: Date): Promise<void>;

    as_chorister(): IChorister;

    as_deposit_owner(): IDepositOwnerAgent;

    as_accounter(): IAccounterAgent;

    as_admin(): IAdminAgent;
}

// Common actions for all choristers
export interface IChorister {
    base(): IUserAgent;

    send_scores_list(scores: Score[]): Promise<Status>;

    on_feedback_received(feedback: Feedback): Promise<Status>;
}

// Someone who has deposit account
export interface IDepositOwnerAgent {
    base(): IUserAgent;

    send_deposit_info(deposit: Deposit | undefined): Promise<Status>;

    send_deposit_changes(deposit: Deposit, changes: DepositChange): Promise<Status>;

    send_already_paid_response(): Promise<Status>;

    send_membership_reminder(amount: number): Promise<Status>;

    send_thanks_for_information(): Promise<Status>;
    
    send_transactions_info(transactions: Transaction[] | undefined): Promise<Status>;
}

// Someone who has accounter role
export interface IAccounterAgent {
    base(): IUserAgent;

    send_already_paid_notification(who: UserData): Promise<Status>;

    send_top_up_notification(who: UserData, amount: number, original_message: string): Promise<Status>;

    mirror_deposit_changes(who: UserData, deposit: Deposit, changes: DepositChange): Promise<Status>;

    mirror_reminder(who: UserData, amount: number): Promise<Status>;
}

// Someone who has admin role
export interface IAdminAgent {
    base(): IUserAgent;

    send_notification(message: string): Promise<Status>;

    send_runtime_backup(filepath: string): Promise<Status>;

    send_logs(filepath: string): Promise<Status>;
}
