import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { IJournal } from "@src/interfaces/journal.js";

export class CoreAPI {
    private static journal?: IJournal;

    static attach_journal(journal: IJournal): void {
        this.journal = journal;
    }

    public static on_new_user_agent(user_id: string, agent: IUserAgent): Status {
        const runtime = Runtime.get_instance();
        const user = runtime.ensure_user_logic(user_id);
        if (!user) {
            return Expected.err(`user '${user_id}' not found`);
        }
        user.add_agent(agent);
        this.journal?.info(`New user agent ${user_id} added`);
        return Expected.ok(undefined);
    }

}
