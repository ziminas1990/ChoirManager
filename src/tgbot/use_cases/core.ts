import lodash from "lodash";

import { Status, StatusWith } from "@src/status.js";
import { User } from "@src/tgbot/database.js";
import { Runtime } from "@src/tgbot/runtime.js";

export class CoreAPI {

    public static get_user_by_tg_id(tg_id: string, create_guest: boolean = true): StatusWith<User> {
        const runtime = Runtime.get_instance();
        const user = runtime.get_database().get_user(tg_id);
        if (user) {
            return Status.ok().with(user);
        }
        if (create_guest) {
            const guest = runtime.get_database().create_guest_user(tg_id);
            return Status.ok().with(lodash.cloneDeep(guest));
        }
        return Status.fail("user not found");
    }

}