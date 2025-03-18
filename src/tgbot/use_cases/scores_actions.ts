import { Status } from "../../status.js";
import { Journal } from "../journal.js";
import { Dialog } from "../logic/dialog.js";
import { Runtime } from "../runtime.js";
import { return_fail } from "../utils.js";


export class ScoresActions {

    static async scores_list_requested(
        runtime: Runtime,
        userid: string,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        const user = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        const scores_dialog = user.get_scores_dialog();
        if (!scores_dialog) {
            return return_fail(`no scores dialog`, journal.log());
        }
        return await scores_dialog.send_scores_list(dialog);
    }


    static async download_scores(
        runtime: Runtime,
        userid: string,
        filename: string,
        journal: Journal,
        dialog?: Dialog
    ): Promise<Status> {
        const user = runtime.get_user(userid);
        if (!user) {
            return return_fail(`user ${userid} not found`, journal.log());
        }
        const scores_dialog = user.get_scores_dialog();
        if (!scores_dialog) {
            return return_fail(`no scores dialog`, journal.log());
        }
        return await scores_dialog.send_scores(filename, dialog);
    }
}

