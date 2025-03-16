import { Status } from "../../status.js";
import { Journal } from "../journal.js";
import { Runtime } from "../runtime.js";
import { return_fail } from "../utils.js";


export class DepositActions {

    static async top_up(runtime: Runtime, userid: string, amount: number, original_message: string, journal: Journal)
    : Promise<Status> {
        journal.log().info(`top_up ${userid} ${amount} ${original_message}`);
        const all_users = runtime.get_users();
        const user = all_users.get(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        {
            const deposit_activity = user.get_deposit_activity();
            if (!deposit_activity) {
                return return_fail(`user ${userid} has no deposit activity`, journal.log());
            }
            const status = await deposit_activity.send_thanks_for_information();
            if (!status.ok()) {
                journal.log().warn(`send_thanks_for_information() failed for ${userid}: ${status.what()}`);
            }
        }

        for (const user of all_users.values()) {
            if (!user.is_accountant()) {
                continue;
            }
            const deposit_activity = user.get_deposit_activity();
            if (deposit_activity) {
                const status = await deposit_activity.send_top_up_notification(userid, amount, original_message);
                if (!status.ok()) {
                    return status;
                }
            }
        }

        return Status.ok();
    }

    static async already_paid(runtime: Runtime, userid: string, journal: Journal): Promise<Status> {
        journal.log().info(`handle already_paid by ${userid}`);
        const all_users = runtime.get_users();
        const user = all_users.get(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }

        {
            const deposit_activity = user.get_deposit_activity();
            if (!deposit_activity) {
                return return_fail(`user ${userid} has no deposit activity`, journal.log());
            }
            const status = await deposit_activity.send_already_paid_response();
            if (!status.ok()) {
                journal.log().warn(`send_already_paid_response() failed ${userid}: ${status.what()}`);
            }
        }

        for (const user of all_users.values()) {
            if (!user.is_accountant()) {
                continue;
            }

            const deposit_activity = user.get_deposit_activity();
            if (deposit_activity) {
                const status = await deposit_activity.send_already_paid_notification(userid);
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

}