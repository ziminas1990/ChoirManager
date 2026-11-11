import { MemoryJournal } from "@src/components/memory_journal.js";
import { UserService } from "@src/components/user_service.js";
import { Database } from "@src/database.js";
import { UserData } from "@src/entities/user.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Runtime } from "@src/runtime.js";

import { mock_collection } from "./collection.js";
import { bot_config } from "@tests/helpers/config.js";
import { value } from "@tests/helpers/expected.js";

export function mock_runtime(overrides: Partial<Runtime> = {}): Runtime {
    // Isolate the existing singleton while creating a complete runtime object.
    const previous = Runtime["instance"];
    Runtime["instance"] = undefined;
    try {
        const journal = new MemoryJournal();
        const users = new UserService(mock_collection<UserData, UserPatch>(), journal);
        const runtime = value(Runtime.unpack(bot_config(), new Database(), users,
            { version: 4, users: [], tg_adapter: undefined }, journal));
        return Object.assign(runtime, overrides);
    } finally {
        Runtime["instance"] = previous;
    }
}
