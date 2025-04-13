import { Status } from "@src/status.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Runtime } from "@src/runtime.js";
import { return_fail } from "@src/utils.js";
import { UserLogic } from "@src/logic/user.js";
import { DepositsTrackerEvent } from "@src/logic/deposits_tracker.js";
import { Deposit, DepositChange } from "@src/fetchers/deposits_fetcher.js";


export class DepositActions {

    static async deposit_requested(
        agent: IUserAgent,
        journal: Journal
    ): Promise<Status> {
        const user = Runtime.get_instance().get_user(agent.userid());
        if (!user) {
            return return_fail(`user ${agent.userid()} not found`, journal.log());
        }

        if (user.is_guest()) {
            return return_fail(`user ${agent.userid()} is a guest`, journal.log());
        }



        return await agent.as_deposit_owner().send_deposit_info(
            user.get_deposit_tracker()?.get_deposit()
        );
    }

    static async top_up(
        agent: IUserAgent,
        amount: number,
        original_message: string,
        journal: Journal,
    ): Promise<Status> {
        const user_id = agent.userid();
        journal.log().info(`top_up ${user_id} ${amount} ${original_message}`);

        const runtime = Runtime.get_instance();
        const user = runtime.get_user(user_id, false);
        if (!user) {
            return return_fail(`user ${user_id} not found`, journal.log());
        }

        if (user.is_guest()) {
            return return_fail(`user ${user_id} is a guest`, journal.log());
        }

        {
            const status = await agent.as_deposit_owner().send_thanks_for_information();
            if (!status.ok()) {
                journal.log().warn([
                    `failed to send thanks_for_information to ${user_id}`,
                    status.what()
                ].join(":"));
            }
        }

        // Notify all accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accounter of accountants) {
            const accounter_agents = accounter.as_accounter();
            if (!accounter_agents) {
                continue;
            }
            for (const accounter of accounter_agents) {
                const status = await accounter.send_top_up_notification(
                    user.data, amount, original_message);
                if (!status.ok()) {
                    journal.log().warn([
                        `failed to send top_up notification to ${accounter.base().userid()}`,
                        status.what()
                    ].join(":"));
                }
            }
        }
        return Status.ok();
    }

    static async already_paid(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Status> {
        const user_id = agent.userid();
        journal.log().info(`handle already_paid by ${user_id}`);

        const runtime = Runtime.get_instance();
        const user = runtime.get_user(user_id, false);
        if (!user) {
            return return_fail(`user ${user_id} not found`, journal.log());
        }

        {
            const status = await agent.as_deposit_owner().send_already_paid_response();
            if (!status.ok()) {
                journal.log().warn([
                    `failed to send already_paid response to ${user_id}`,
                    status.what()
                ].join(":"));
            }
        }

        // Notify all accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accountant of accountants) {
            const accounter_agents = accountant.as_accounter();
            if (!accounter_agents) {
                continue;
            }
            for (const accounter of accounter_agents) {
                const status = await accounter.send_already_paid_notification(user.data);
                if (!status.ok()) {
                    journal.log().warn([
                        `failed to send already_paid notification to ${user.data.tgid}`,
                        status.what()
                    ].join(":"));
                }
            }
        }
        return Status.ok();
    }

    static async send_deposit_update(
        user: UserLogic,
        deposit: Deposit,
        changes: DepositChange,
        journal: Journal,
    ): Promise<Status>
    {
        journal.log().info(`send_deposit_update for ${user.data.tgid}`);

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog || deposit_owner_dialog.length === 0) {
            return Status.fail(`user ${user.data.tgid} has no agents`);
        }

        let total = 0;
        for (const dialog of deposit_owner_dialog) {
            const status = await dialog.send_deposit_changes(deposit, changes);
            if (status.ok()) {
                total += 1;
            }
        }

        if (total == 0) {
            return Status.fail(`failed to send deposit changes to any agent`);
        }

        // Notify accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accounter of accountants) {
            const accounter_dialog = accounter.as_accounter() ?? [];
            for (const dialog of accounter_dialog) {
                await dialog.mirror_deposit_changes(user.data, deposit, changes);
            }
        }
        return Status.ok();
    }

    static async send_reminder(
        user: UserLogic,
        amount: number,
        journal: Journal
    ): Promise<Status>
    {
        const userid = user.data.tgid;
        journal.log().info(`send_reminder for @${userid}`);

        if (amount < 10) {
            journal.log().info(`skipping reminder for @${userid} because amount is too small: ${amount}`);
            // It's okay to move it to the next month
            return Status.ok();
        }

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog || deposit_owner_dialog.length === 0) {
            journal.log().info(`skipping reminder for @${userid} because they have no deposit dialogs`);
            return Status.ok();
        }

        let total = 0;
        for (const dialog of deposit_owner_dialog) {
            const status = await dialog.send_membership_reminder(amount);
            if (status.ok()) {
                total += 1;
            }
        }

        if (total == 0) {
            return Status.fail(`failed to send reminder to any agent`);
        }

        // Notify accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accounter of accountants) {
            const accounter_dialog = accounter.as_accounter() ?? [];
            for (const dialog of accounter_dialog) {
                await dialog.mirror_reminder(user.data, amount);
            }
        }

        return Status.ok();
    }

    static async handle_deposit_tracker_event(
        user: UserLogic,
        event: DepositsTrackerEvent,
        journal: Journal,
    ): Promise<Status> {
        journal.log().info({ event }, `got event`);
        switch (event.what) {
            case "update":
                return await this.send_deposit_update(
                    user, event.deposit, event.changes, journal);
            case "reminder":
                return await this.send_reminder(user, event.amount, journal);
            default:
                return Status.fail(`Unknown event type: ${(event as any).what}`);
        }
    }
}
