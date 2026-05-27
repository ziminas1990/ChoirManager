import lodash from "lodash";

import { Expected, Status } from "@src/utils/expected.js";
import { User } from "@src/database.js";
import { Runtime } from "@src/runtime.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";

export class CoreAPI {
    private static journal?: Journal;

    static attach_journal(journal: Journal): void {
        this.journal = journal;
    }

    public static get_user_by_tg_id(tg_id: string, create_guest: boolean = false): Expected<User> {
        const runtime = Runtime.get_instance();
        const user = runtime.get_database().get_user(tg_id);
        if (user) {
            return Expected.ok(user);
        }
        if (create_guest) {
            const guest = runtime.get_database().create_guest_user(tg_id);
            this.journal?.log().info(`Created guest user ${tg_id}`);
            return Expected.ok(lodash.cloneDeep(guest));
        }
        this.journal?.log().warn(`user @${tg_id} not found`);
        return Expected.err("user not found");
    }

    public static on_new_user_agent(tg_id: string, agent: IUserAgent): Status {
        const runtime = Runtime.get_instance();
        const user = runtime.get_user(tg_id);
        if (!user) {
            return Expected.err(`user @${tg_id} not found`);
        }
        user.add_agent(agent);
        this.journal?.log().info(`New user agent ${tg_id} added`);
        return Expected.ok(undefined);
    }

}