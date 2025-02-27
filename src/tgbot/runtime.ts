import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import crypto from "crypto";

import { Status, StatusWith } from "../status.js";
import { Database, Role } from "./database.js";
import { UserLogic } from "./logic/user.js";
import { pack_map, unpack_map } from "./utils.js";
import { AnnounceTranslator } from "./activities/translator.js";
import { AdminPanel } from "./activities/admin_panel.js";


class RuntimeCfg {
    constructor(
        public filename: string,
        public choir_chat_id?: number,
        public announce_chat_id?: number,
        public manager_chat_id?: number,
    ) {}

    static pack(cfg: RuntimeCfg) {
        return [cfg.filename, cfg.choir_chat_id, cfg.announce_chat_id, cfg.manager_chat_id] as const;
    }

    static unpack(packed: ReturnType<typeof RuntimeCfg.pack>): RuntimeCfg {
        const [filename, choir_chat_id, announce_chat_id, manager_chat_id] = packed;
        return new RuntimeCfg(filename, choir_chat_id, announce_chat_id, manager_chat_id);
    }
}

export class Runtime {

    static Load(filename: string, database: Database): StatusWith<Runtime> {
        try {
            const packed = JSON.parse(fs.readFileSync(filename, "utf8"));
            return Runtime.unpack(filename, database, packed);
        } catch (e) {
            return StatusWith.ok().with(new Runtime(database, new RuntimeCfg(filename)));
        }
    }

    private next_dump: Date = new Date();
    private guest_user: UserLogic | undefined;
    private update_interval_sec: number = 0;
    private translator: AnnounceTranslator;
    private admin_panel: AdminPanel;

    private runtime_hash?: string;

    private last_backup?: {
        hash: string;
        time: Date;
    };

    private constructor(
        private database: Database,
        private cfg: RuntimeCfg,
        private users: Map<number, UserLogic> = new Map())
    {
        this.translator = new AnnounceTranslator(this);
        this.admin_panel = new AdminPanel(this);
    }


    async start(update_interval_sec: number = 60): Promise<Status> {
        this.admin_panel.start();
        this.translator.start();

        this.update_interval_sec = update_interval_sec;
        if (this.update_interval_sec > 0) {
            this.next_dump = new Date(Date.now() + this.update_interval_sec * 1000);
        }
        return Status.ok();
    }

    handle_private_message(msg: TelegramBot.Message): Status {
        log_message(msg);

        const username = msg.from?.username;
        if (username == undefined) {
            return Status.fail("username is undefined");
        }

        const user = this.get_user(username);
        return user.on_message(msg);
    }

    handle_group_message(msg: TelegramBot.Message): Status {
        log_message(msg);

        const username = msg.from?.username;
        if (username == undefined) {
            return Status.fail("username is undefined");
        }
        const user = this.get_user(username);

        const sent_by_admin   = user.is_admin();
        const sent_to_bot     = msg.text?.includes("@ursa_major_choir");
        const is_announce     = msg.chat.id == this.cfg.choir_chat_id &&
                                msg.message_thread_id == this.cfg.announce_chat_id;
        const sent_by_manager = user.data.roles.includes(Role.Manager);

        if (sent_by_admin && sent_to_bot) {
            return this.admin_panel.handle_message(msg);
        }

        if (is_announce && sent_by_manager) {
            this.translator.on_announce(msg);
        }
        return Status.ok();
    }

    handle_callback(query: TelegramBot.CallbackQuery): Status {
        const username = query.from?.username
        console.log(`Callback query from ${username} in ${query.message?.chat.id}: ${query.data}`);
        if (username == undefined) {
            return Status.fail("username is undefined");
        }

        let user = this.get_user(username);
        return user.on_callback(query);
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

    set_announce_thread(chat_id: number, thread_id: number): void {
        this.cfg.choir_chat_id = chat_id;
        this.cfg.announce_chat_id = thread_id;
    }

    set_manager_chat_id(chat_id: number): void {
        this.cfg.manager_chat_id = chat_id;
    }

    async proceed(now: Date): Promise<Status> {
        const user_proceeds: Promise<Status>[] = [];
        for (const user of this.users.values()) {
            user_proceeds.push(user.proceed(now));
        }
        await Promise.all(user_proceeds);

        if (now >= this.next_dump && this.update_interval_sec > 0) {
            this.dump();
            this.next_dump = new Date(Date.now() + this.update_interval_sec * 1000);
        }
        return Status.ok();
    }

    dump(): void {
        const runtime_data = JSON.stringify(Runtime.pack(this));
        const runtime_hash = crypto.createHash("sha256").update(runtime_data).digest("hex");

        if (this.runtime_hash == undefined) {
            this.runtime_hash = runtime_hash;
            this.last_backup = {
                hash: runtime_hash,
                time: new Date(),
            };
            return;
        }

        if (runtime_hash != this.runtime_hash) {
            console.log("Updating runtime, hash:", runtime_hash);
            fs.writeFileSync(this.cfg.filename, JSON.stringify(Runtime.pack(this)));
            this.runtime_hash = runtime_hash;
        }

        if (this.last_backup && this.last_backup.hash != runtime_hash) {
            const time_diff = new Date().getTime() - this.last_backup.time.getTime();
            // Do backup once a day
            if (time_diff > 24 * 60 * 60 * 1000) {
                console.log("Sending runtime backup, hash:", runtime_hash);
                this.last_backup = {
                    hash: runtime_hash,
                    time: new Date(),
                };
                this.admin_panel.send_file_to_admin(this.cfg.filename, "application/json");
            }
        }
    }

    static pack(runtime: Runtime) {
        return [RuntimeCfg.pack(runtime.cfg), pack_map(runtime.users, UserLogic.pack)] as const;
    }

    static unpack(filename: string, database: Database, packed: ReturnType<typeof Runtime.pack>)
    : StatusWith<Runtime>
    {
        const [cfg, users] = packed;
        const config = RuntimeCfg.unpack(cfg);
        config.filename = filename;
        const runtime = new Runtime(database, config);

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

function log_message(msg: TelegramBot.Message) {
    if (msg.text) {
        if (!msg.text.includes("\n")) {
            console.log(`Message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);
        } else {
            console.log([
                "-".repeat(40),
                `Message from ${msg.from?.username} in ${msg.chat.id}:`,
                msg.text,
                "=".repeat(40),
            ].join("\n"));
        }
    } else {
        console.log(`Empty message from ${msg.from?.username} in ${msg.chat.id}`);
    }
}