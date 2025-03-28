import { Status } from "@src/status.js";
import { Deposit, DepositChange } from "@src/tgbot/fetchers/deposits_fetcher.js";
import { Scores, User } from "@src/tgbot/database.js";


export interface IUserAgent extends
    IDepositOwnerAgent,
    IScoresSubscriberAgent,
    IAccounterAgent,
    IAdminAgent
{}

export interface IBaseAgent {
    userid(): string;

    send_message(message: string): Promise<Status>;

    send_file(filename: string, caption?: string, content_type?: string): Promise<Status>;
}

// Someone who can access scores
export interface IScoresSubscriberAgent extends IBaseAgent {
    send_scores_list(scores: Scores[]): Promise<Status>;
}

// Someone who has deposit account
export interface IDepositOwnerAgent extends IBaseAgent {
    send_deposit_info(deposit: Deposit | undefined): Promise<Status>;

    send_deposit_changes(deposit: Deposit, changes: DepositChange): Promise<Status>;

    send_already_paid_response(): Promise<Status>;

    send_membership_reminder(amount: number): Promise<Status>;

    send_thanks_for_information(): Promise<Status>;
}

// Someone who has accounter role
export interface IAccounterAgent extends IBaseAgent {
    send_already_paid_notification(who: User): Promise<Status>;

    send_top_up_notification(who: User, amount: number, original_message: string): Promise<Status>;

    mirror_deposit_changes(who: User, deposit: Deposit, changes: DepositChange): Promise<Status>;
}

// Someone who has admin role
export interface IAdminAgent extends IBaseAgent {
    send_notification(message: string): Promise<Status>;
}
