import { Expected, Status } from "@src/utils/expected.js";
import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { Scores } from "@src/database.js";
import { UserData } from "@src/entities/user.js";
import { Feedback } from "@src/entities/feedback.js";
import { Transaction } from "./transactions_storage";


export interface IUserAgent
{
    agent_name(): string;

    userid(): string;

    send_message(message: string): Promise<Expected<number>>;

    send_file(filename: string, caption?: string, content_type?: string): Promise<Status>;

    proceed(now: Date): Promise<void>;

    as_chorister(): IChorister;

    as_deposit_owner(): IDepositOwnerAgent;

    as_accounter(): IAccounterAgent;

    as_admin(): IAdminAgent;
}

// Common actions for all choristers
export interface IChorister {
    base(): IUserAgent;

    send_scores_list(scores: Scores[]): Promise<Status>;

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
