import { Status } from "../../status.js";
import { Deposit, DepositChange } from "../fetchers/deposits_fetcher.js";
import { Journal } from "../journal.js";
import { DepositsTrackerEvent } from "../logic/deposits_tracker.js";
import { Dialog } from "../logic/dialog.js";
import { Runtime } from "../runtime.js";
import { return_fail } from "../utils.js";


export class DepositActions {

    static async deposit_requested(
        runtime: Runtime,
        userid: string,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        const user = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        const deposit_info = user.get_deposit_tracker()?.get_deposit()
        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog) {
            return return_fail("no deposit owner dialog", journal.log());
        }

        return await deposit_owner_dialog.send_deposit_info(deposit_info, dialog);
    }

    static async top_up(
        runtime: Runtime,
        userid: string,
        amount: number,
        original_message: string,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        journal.log().info(`top_up ${userid} ${amount} ${original_message}`);
        const all_users = runtime.get_users();
        const user = all_users.get(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        {
            const deposit_owner_dialog = user.as_deposit_owner();
            if (!deposit_owner_dialog) {
                return return_fail(`user ${userid} has no deposit activity`, journal.log());
            }
            const status = await deposit_owner_dialog.send_thanks_for_information(dialog);
            if (!status.ok()) {
                journal.log().warn(`send_thanks_for_information() failed for ${userid}: ${status.what()}`);
            }
        }

        for (const user of all_users.values()) {
            const accounter_dialog = user.as_accounter();
            if (accounter_dialog) {
                const status = await accounter_dialog.send_top_up_notification(
                    userid, amount, original_message);
                if (!status.ok()) {
                    return status;
                }
            }
        }

        return Status.ok();
    }

    static async already_paid(
        runtime: Runtime,
        userid: string,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        journal.log().info(`handle already_paid by ${userid}`);
        const all_users = runtime.get_users();
        const user = all_users.get(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        {
            const deposit_owner_dialog = user.as_deposit_owner();
            if (!deposit_owner_dialog) {
                return return_fail(`user ${userid} has no deposit activity`, journal.log());
            }
            const status = await deposit_owner_dialog.send_already_paid_response(dialog);
            if (!status.ok()) {
                journal.log().warn(`send_already_paid_response() failed ${userid}: ${status.what()}`);
            }
        }

        for (const user of all_users.values()) {
            const accounter_dialog = user.as_accounter();
            if (accounter_dialog) {
                const status = await accounter_dialog.send_already_paid_notification(userid);
                if (!status.ok()) {
                    journal.log().warn([
                        `faild to send already_paid notification to ${user.data.tgid}`,
                        status.what()
                    ].join(":"));
                }
            }
        }
        return Status.ok();
    }

    static async send_deposit_update(
        runtime: Runtime,
        userid: string,
        deposit: Deposit,
        changes: DepositChange,
        journal: Journal,
        dialog?: Dialog,
    ): Promise<Status>
    {
        const user = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog) {
            return return_fail(`user ${userid} has no deposit dialog`, journal.log());
        }

        const sent_message = await deposit_owner_dialog.on_deposit_change(deposit, changes, dialog);
        if (!sent_message.ok()) {
            return sent_message;
        }

        // Notify accountants
        for (const accounter of runtime.get_users().values()) {
            const accounter_dialog = accounter.as_accounter();
            if (accounter_dialog) {
                const status = await accounter_dialog.mirror_message(
                    sent_message.value!, user.data);
                if (!status.ok()) {
                    journal.log().warn([
                        `failed to mirror top_up_notification to ${accounter.data.tgid}`,
                        status.what()
                    ].join(":"));
                }
            }
        }
        return Status.ok();
    }

    static async send_reminder(
        runtime: Runtime,
        userid: string,
        amount: number,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status>
    {
        const user = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        if (!user.is_chorister() && !user.is_ex_chorister()) {
            journal.log().info(`skipping reminder for ${userid} because they are not chorister`);
            return Status.ok();
        }
        if (amount < 10) {
            journal.log().info(`skipping reminder for ${userid} because amount is too small: ${amount}`);
            // It's okay to move it to the next month
            return Status.ok();
        }

        const deposit_owner_dialog = user.as_deposit_owner();
        if (!deposit_owner_dialog) {
            return return_fail(`user ${userid} has no deposit dialog`, journal.log());
        }

        const send_status = await deposit_owner_dialog.send_reminder(amount, dialog);
        if (!send_status.ok()) {
            return send_status;
        }
        const message = send_status.value!;

        // Notify accountants
        for (const accounter of runtime.get_users().values()) {
            const accounter_dialog = accounter.as_accounter();
            if (accounter_dialog) {
                const status = await accounter_dialog.mirror_message(message, user.data);
                if (!status.ok()) {
                    journal.log().warn([
                        `failed to mirror reminder to ${accounter.data.tgid}`,
                        status.what()
                    ].join(":"));
                }
            }
        }

        return Status.ok();
    }

    static async handle_deposit_tracker_event(
        runtime: Runtime,
        userid: string,
        event: DepositsTrackerEvent,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        journal.log().info({ event }, `got event`);
        switch (event.what) {
            case "update":
                return await this.send_deposit_update(
                    runtime,
                    userid,
                    event.deposit,
                    event.changes,
                    journal,
                    dialog
                );
            case "reminder":
                return await this.send_reminder(runtime, userid, event.amount, journal, dialog);
            default:
                return Status.fail(`Unknown event type: ${(event as any).what}`);
        }
    }

}
