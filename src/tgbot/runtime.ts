import { Status, StatusWith } from "../status.js";
import { Database } from "./database.js";
import { UserLogic } from "./logic/user.js";
import { pack_map, unpack_map } from "./utils.js";
import fs from "fs";

const dump_interval_ms = 1000 * 60;  // 1 minute

export class Runtime {

    static Load(filename: string, database: Database): StatusWith<Runtime> {
        try {
            const packed = JSON.parse(fs.readFileSync(filename, "utf8"));
            return Runtime.unpack(filename, database, packed);
        } catch (e) {
            return StatusWith.ok().with(new Runtime(database, filename));
        }
    }

    private next_dump: Date = new Date();
    private guest_user: UserLogic | undefined;

    private constructor(
        private database: Database,
        private cache_filename: string,
        private users: Map<number, UserLogic> = new Map())
    {
        this.next_dump = new Date(Date.now() + dump_interval_ms);
    }

    get_user(tg_id: string): UserLogic {
        const user = this.database.get_user_by_tg_id(tg_id);
        if (user) {
            let user_logic = this.users.get(user.id);
            if (!user_logic) {
                user_logic = new UserLogic(user);
                this.users.set(user.id, user_logic);
            }
            return user_logic;
        }
        return this.get_guest_user();
    }

    get_guest_user(): UserLogic {
        if (!this.guest_user) {
            this.guest_user = new UserLogic(this.database.get_guest_user());
        }
        return this.guest_user;
    }

    all_users(): IterableIterator<UserLogic> {
        return this.users.values();
    }

    proceed(now: Date): void {
        for (const user of this.users.values()) {
            user.proceed(now);
        }
        if (now >= this.next_dump) {
            this.dump();
            this.next_dump = new Date(Date.now() + dump_interval_ms);
        }
    }

    dump(): void {
        fs.writeFileSync(this.cache_filename, JSON.stringify(Runtime.pack(this)));
    }

    static pack(runtime: Runtime) {
        return [pack_map(runtime.users, UserLogic.pack)] as const;
    }

    static unpack(filename: string, database: Database, packed: ReturnType<typeof Runtime.pack>)
    : StatusWith<Runtime>
    {
        const [users] = packed;
        const runtime = new Runtime(database, filename);

        const load_users_problems: Status[] = [];
        runtime.users = unpack_map(users, (packed) => {
            const status = UserLogic.unpack(database, packed);
            if (!status.ok()) {
                load_users_problems.push(status);
            }
            return status.value;
        });

        const status =
            load_users_problems.length > 0 ?
            Status.warning("loading users", load_users_problems) :
            Status.ok();

        return status.with(runtime);
    }
}
