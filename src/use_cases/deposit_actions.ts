import { Expected, Status } from "@src/utils/expected.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Runtime } from "@src/runtime.js";
import { return_fail } from "@src/utils.js";
import { UserLogic } from "@src/logic/user.js";
import { DepositEvent } from "@src/interfaces/deposit_service.js";
import { Deposit, DepositChange } from "@src/entities/deposit.js";
import { Role, user_has_role, user_tgid } from "@src/entities/user.js";
import { Environment } from "@src/components/environment.js";


export class DepositActions {

    static async deposit_requested(
        agent: IUserAgent,
        journal: Journal
    ): Promise<Status> {
        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: userid });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (user_has_role(resolved.value, Role.Guest)) {
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        const deposit_service = Environment.global.maybe_deposit_service;
        if (!deposit_service) {
            return return_fail(`deposit service is not configured`, journal.log());
        }

        const deposit = await deposit_service.get_deposit(userid);
        if (!deposit.ok) {
            return return_fail(`failed to get deposit for ${userid}: ${deposit.error}`, journal.log());
        }

        return await agent.as_deposit_owner().send_deposit_info(deposit.value);
    }

    static async transactions_requested(
        agent: IUserAgent,
        journal: Journal,
        limit?: number
    ): Promise<Status> {
        const userid = agent.userid();
        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: userid });
        journal.log().info(`transactions_requested by ${resolved.ok && resolved.value ? user_tgid(resolved.value) : undefined}`);
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (user_has_role(resolved.value, Role.Guest)) {
            return return_fail(`user ${userid} is a guest`, journal.log());
        }

        const deposit_service = Environment.global.maybe_deposit_service;
        if (!deposit_service) {
            return return_fail(`deposit service is not configured`, journal.log());
        }

        const transactions = await deposit_service.fetch_transactions(
            user_tgid(resolved.value), { limit });
        return await agent.as_deposit_owner().send_transactions_info(transactions);
    }

    static async top_up(
        agent: IUserAgent,
        amount: number,
        original_message: string,
        journal: Journal,
    ): Promise<Status> {
        const user_id = agent.userid();
        journal.log().info(`top_up ${user_id} ${amount} ${original_message}`);

        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: user_id });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${user_id} not found`, journal.log());
        }
        if (user_has_role(resolved.value, Role.Guest)) {
            return return_fail(`user ${user_id} is a guest`, journal.log());
        }
        const user = resolved.value;

        {
            const status = await agent.as_deposit_owner().send_thanks_for_information();
            if (!status.ok) {
                journal.log().warn([
                    `failed to send thanks_for_information to ${user_id}`,
                    status.error
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
                    user, amount, original_message);
                if (!status.ok) {
                    journal.log().warn([
                        `failed to send top_up notification to ${accounter.base().userid()}`,
                        status.error
                    ].join(":"));
                }
            }
        }
        return Expected.ok(undefined);
    }

    static async already_paid(
        agent: IUserAgent,
        journal: Journal,
    ): Promise<Status> {
        const user_id = agent.userid();
        journal.log().info(`handle already_paid by ${user_id}`);

        const resolved = await Environment.global.user_service.resolve_user({ telegram_id: user_id });
        if (!resolved.ok || !resolved.value) {
            return return_fail(`user ${user_id} not found`, journal.log());
        }
        const user = resolved.value;

        {
            const status = await agent.as_deposit_owner().send_already_paid_response();
            if (!status.ok) {
                journal.log().warn([
                    `failed to send already_paid response to ${user_id}`,
                    status.error
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
                const status = await accounter.send_already_paid_notification(user);
                if (!status.ok) {
                    journal.log().warn([
                        `failed to send already_paid notification to ${user_tgid(user)}`,
                        status.error
                    ].join(":"));
                }
            }
        }
        return Expected.ok(undefined);
    }

    static async send_deposit_update(
        user: UserLogic,
        deposit: Deposit,
        changes: DepositChange,
        journal: Journal,
    ): Promise<Status>
    {
        const tgid = user_tgid(user.data);
        journal.log().info(`send_deposit_update for ${tgid}`);

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog || deposit_owner_dialog.length === 0) {
            return Expected.err(`user ${tgid} has no agents`);
        }

        let total = 0;
        for (const dialog of deposit_owner_dialog) {
            const status = await dialog.send_deposit_changes(deposit, changes);
            if (status.ok) {
                total += 1;
            }
        }

        if (total == 0) {
            return Expected.err(`failed to send deposit changes to any agent`);
        }

        // Notify accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accounter of accountants) {
            const accounter_dialog = accounter.as_accounter() ?? [];
            for (const dialog of accounter_dialog) {
                await dialog.mirror_deposit_changes(user.data, deposit, changes);
            }
        }

        // Transaction writes are owned by DepositService.
        return Expected.ok(undefined);
    }

    static async send_reminder(
        user: UserLogic,
        amount: number,
        journal: Journal
    ): Promise<Status>
    {
        const userid = user_tgid(user.data);
        journal.log().info(`send_reminder for @${userid}`);

        if (amount < 10) {
            journal.log().info(`skipping reminder for @${userid} because amount is too small: ${amount}`);
            // It's okay to move it to the next month
            return Expected.ok(undefined);
        }

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog || deposit_owner_dialog.length === 0) {
            journal.log().info(`skipping reminder for @${userid} because they have no deposit dialogs`);
            return Expected.ok(undefined);
        }

        let total = 0;
        for (const dialog of deposit_owner_dialog) {
            const status = await dialog.send_membership_reminder(amount);
            if (status.ok) {
                total += 1;
            }
        }

        if (total == 0) {
            return Expected.err(`failed to send reminder to any agent`);
        }

        // Notify accountants
        const accountants = Runtime.get_instance().get_users(user => user.is_accountant());
        for (const accounter of accountants) {
            const accounter_dialog = accounter.as_accounter() ?? [];
            for (const dialog of accounter_dialog) {
                await dialog.mirror_reminder(user.data, amount);
            }
        }

        return Expected.ok(undefined);
    }

    static async handle_deposit_event(
        event: DepositEvent,
        journal: Journal,
    ): Promise<Status> {
        journal.log().info({ event }, `got event`);

        const user = Runtime.get_instance().get_user_logic(event.tgid);
        if (!user) {
            return Expected.err(`user ${event.tgid} has no runtime session`);
        }

        switch (event.what) {
            case "update":
                return await this.send_deposit_update(
                    user, event.deposit, event.changes, journal);
            case "reminder":
                return await this.send_reminder(user, event.amount, journal);
            default:
                return Expected.err(`Unknown event type: ${(event as any).what}`);
        }
    }
}
