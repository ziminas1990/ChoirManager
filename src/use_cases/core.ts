import { Expected, Status } from "@src/utils/expected.js";
import { Runtime } from "@src/runtime.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";

export class CoreAPI {
    private static journal?: Journal;

    static attach_journal(journal: Journal): void {
        this.journal = journal;
    }

    public static on_new_user_agent(tg_id: string, agent: IUserAgent): Status {
        const runtime = Runtime.get_instance();
        const user = runtime.ensure_user_logic(tg_id);
        if (!user) {
            return Expected.err(`user @${tg_id} not found`);
        }
        user.add_agent(agent);
        this.journal?.log().info(`New user agent ${tg_id} added`);
        return Expected.ok(undefined);
    }

}
