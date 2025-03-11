import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import crypto from "crypto";

import { Status, StatusWith } from "../status.js";
import { Database, Language, Role, User, Voice } from "./database.js";
import { UserLogic } from "./logic/user.js";
import { pack_map, return_exception, return_fail, unpack_map } from "./utils.js";
import { AnnounceTranslator } from "./activities/translator.js";
import { AdminPanel } from "./activities/admin_panel.js";
import { DepositsFetcher } from "./fetchers/deposits_fetcher.js";
import { Config } from "./config.js";
import { Proceeder } from "./logic/abstracts.js";
import { DocumentsFetcher } from "./fetchers/document_fetcher.js";
import { ChoristerAssistant } from "./ai_assistants/chorister_assistant.js";
import { UsersFetcher } from "./fetchers/users_fetcher.js";
import { ScoresFetcher } from "./fetchers/scores_fetcher.js";
import pino from "pino";


class RuntimeCfg {
    constructor(
        public filename: string,
        public choir_chat_id?: number,
        public announce_chat_id?: number,
        public manager_chat_id?: number,
    ) {}

    static pack(cfg: RuntimeCfg) {
        return {
            "cfg": cfg.filename,
            "chat_id": cfg.choir_chat_id,
            "announces_chat_id": cfg.announce_chat_id,
            "managers_chat_id": cfg.manager_chat_id
         } as const;
    }

    static unpack(packed: ReturnType<typeof RuntimeCfg.pack>): RuntimeCfg {
        return new RuntimeCfg(
            packed.cfg, packed.chat_id, packed.announces_chat_id, packed.managers_chat_id);
    }
}

export class Runtime {

    private static instance?: Runtime;

    static Load(filename: string, database: Database, logger: pino.Logger): StatusWith<Runtime> {
        try {
            const packed = JSON.parse(fs.readFileSync(filename, "utf8"));
            return Runtime.unpack(filename, database, packed, logger);
        } catch (e) {
            const empty_runtime = new Runtime(database, new RuntimeCfg(filename), "", new Map(), logger);
            return StatusWith.ok().with(empty_runtime);
        }
    }

    private next_dump: Date = new Date();
    private update_interval_sec: number = 0;
    private translator: AnnounceTranslator;
    private admin_panel: AdminPanel;
    private users_fetcher?: UsersFetcher;
    private deposits_fetcher?: DepositsFetcher;
    private documents_fetcher?: DocumentsFetcher;
    private scores_fetcher?: ScoresFetcher;

    // We need a separate proceeder for each user to guarantee that all users will
    // be proceeded independently, so that if some user stuck in it's proceed() due to
    // some lokng operation, it won't affect another users
    private user_proceeders: Map<UserLogic, Proceeder<void>> = new Map();

    private last_backup?: {
        hash: string;
        time: Date;
    };

    static get_instance(): Runtime {
        if (!Runtime.instance) {
            throw new Error("Runtime is not initialized");
        }
        return Runtime.instance;
    }

    private constructor(
        private database: Database,
        private cfg: RuntimeCfg,
        private runtime_hash: string,
        private users: Map<string, UserLogic>,
        private logger: pino.Logger,
        private guest_users: Map<string, UserLogic> = new Map())
    {
        if (Runtime.instance) {
            throw new Error("Runtime is already initialized");
        }
        Runtime.instance = this;

        this.translator = new AnnounceTranslator(logger.child({ "activity": "translator" }));
        this.admin_panel = new AdminPanel(logger.child({ "activity": "admin_panel" }));
        this.last_backup = {
            hash: runtime_hash,
            time: new Date(),
        };
    }

    async start(): Promise<Status> {
        const translator_status = await this.translator.start();
        if (!translator_status.ok()) {
            return translator_status.wrap("Failed to start translator");
        }

        if (Config.HasDepoditTracker()) {
            this.deposits_fetcher = new DepositsFetcher();
            const deposits_status = await this.deposits_fetcher.start();
            if (!deposits_status.ok()) {
                return deposits_status.wrap("Failed to start deposits fetcher");
            }
        }

        if (Config.HasAssistant()) {
            this.documents_fetcher = new DocumentsFetcher(Config.Assistant().fetch_interval_sec);
            const documents_status = await this.documents_fetcher.start();
            if (!documents_status.ok()) {
                return documents_status.wrap("Failed to start documents fetcher");
            }
            ChoristerAssistant.init(this.documents_fetcher, this.logger.child({ "assistant": "chorister" }));
        }

        if (Config.HasScoresFetcher()) {
            this.scores_fetcher = new ScoresFetcher(this.database);
            const scores_status = await this.scores_fetcher.start();
            if (!scores_status.ok()) {
                return scores_status.wrap("Failed to start scores fetcher");
            }
        }

        this.update_interval_sec = Config.data.runtime_dump_interval_sec;
        if (this.update_interval_sec > 0) {
            this.next_dump = new Date();
        }

        for (const user of this.users.values()) {
            this.on_user_added(user, true);
        }

        const admin_panel_status = await this.admin_panel.start();
        if (!admin_panel_status.ok()) {
            return admin_panel_status.wrap("Failed to start admin panel");
        }

        return Status.ok();
    }


    get_database(): Database {
        return this.database;
    }

    attach_users_fetcher(fetcher: UsersFetcher): void {
        this.users_fetcher = fetcher;
    }

    handle_private_message(msg: TelegramBot.Message): Status {
        log_message(this.logger, msg);

        const username = msg.from?.username;
        if (username == undefined) {
            return Status.fail("username is undefined");
        }

        const user = this.get_user(username) ?? this.get_guest_user(username);
        return user.on_message(msg);
    }

    async handle_group_message(msg: TelegramBot.Message): Promise<Status> {
        log_message(this.logger, msg);

        const username = msg.from?.username;
        if (username == undefined) {
            return return_fail("username is undefined", this.logger);
        }
        const user = this.get_user(username);
        if (user == undefined) {
            // Ignore guest users in group chats
            return Status.ok();
        }

        const sent_by_admin   = user.is_admin();
        const sent_to_bot     = msg.text?.includes("@ursa_major_choir");
        const is_announce     = msg.chat.id == this.cfg.choir_chat_id &&
                                msg.message_thread_id == this.cfg.announce_chat_id;
        const sent_by_manager = user.data.roles.includes(Role.Manager);

        if (sent_by_admin && sent_to_bot) {
            return await this.admin_panel.handle_message(msg);
        }

        if (is_announce && sent_by_manager) {
            return await this.translator.on_announce(msg);
        }
        return Status.ok();
    }

    handle_callback(query: TelegramBot.CallbackQuery): Status {
        const username = query.from?.username
        this.logger.info(`Callback query from ${username} in ${query.message?.chat.id}: ${query.data}`);
        if (username == undefined) {
            return return_fail("username is undefined", this.logger);
        }

        let user = this.get_user(username) ?? this.get_guest_user(username);
        return user.on_callback(query);
    }

    get_user(tg_id: string): UserLogic | undefined {
        const user = this.database.get_user(tg_id);
        if (user) {
            let user_logic = this.users.get(user.tgid);
            if (!user_logic) {
                const user_logger = this.logger.child({ user: user.tgid });
                user_logic = new UserLogic(user, 100, user_logger);
                this.users.set(user.tgid, user_logic);
                this.on_user_added(user_logic, false);
            }
            return user_logic;
        }
        return this.get_guest_user(tg_id);
    }

    get_guest_user(tg_id: string): UserLogic {
        let user = this.guest_users.get(tg_id);
        if (user == undefined) {
            const user_logger = this.logger.child({ user: tg_id, role: "guest" });
            user = new UserLogic(
                new User(tg_id, "guest", "", Language.RU, Voice.Unknown, [Role.Guest]),
                500,
                user_logger);
            this.guest_users.set(tg_id, user);
            this.on_user_added(user, false);
        }
        return user;
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
        if (this.users_fetcher) {
            const users_status = await this.users_fetcher.proceed();
            if (!users_status.ok()) {
                this.logger.error(users_status.what());
            }
        }

        if (this.deposits_fetcher) {
            const deposits_status = await this.deposits_fetcher.proceed();
            if (!deposits_status.ok()) {
                this.logger.error(deposits_status.what());
            }
        }

        // Check that all users have a related proceeders
        for (const user of [...this.users.values(), ...this.guest_users.values()]) {
            if (this.user_proceeders.has(user)) {
                continue;
            }
            const proceeder = new Proceeder(user, 50);
            proceeder.run();
            this.user_proceeders.set(user, proceeder);
        }

        if (now >= this.next_dump && this.update_interval_sec > 0) {
            this.dump();
            this.next_dump = new Date(Date.now() + this.update_interval_sec * 1000);
        }
        return Status.ok();
    }

    dump(): void {
        const runtime_data = JSON.stringify(Runtime.pack(this));
        const runtime_hash = crypto.createHash("sha256").update(runtime_data).digest("hex");

        if (runtime_hash != this.runtime_hash) {
            this.logger.info(`Updating runtime, hash: ${runtime_hash}`);
            fs.writeFileSync(this.cfg.filename, runtime_data);
            this.runtime_hash = runtime_hash;
        }

        if (this.last_backup && this.last_backup.hash != runtime_hash) {
            const time_diff = new Date().getTime() - this.last_backup.time.getTime();
            // Do backup once a day
            if (time_diff > 10 * 1000) {
                this.send_backup_to_admins();
            }
        }
    }

    static pack(runtime: Runtime) {
        return {
            version: 2,
            cfg: RuntimeCfg.pack(runtime.cfg),
            users: pack_map(runtime.users, UserLogic.pack)
        } as const;
    }

    static unpack(filename: string, database: Database, packed: ReturnType<typeof Runtime.pack>, logger: pino.Logger)
    : StatusWith<Runtime>
    {
        const runtime_hash = crypto.createHash("sha256").update(JSON.stringify(packed)).digest("hex");

        if (packed.version != 2) {
            const old_version: number = packed.version == "1.0" ? 1 : packed.version;

            try {
                packed = update_packed_runtime(old_version, database, packed, logger);
            } catch (e) {
                return return_exception(e, logger, "failed to update runtime data");
            }
        }

        const config = RuntimeCfg.unpack(packed.cfg);
        config.filename = filename;

        const load_users_problems: Status[] = [];
        const users = unpack_map(packed.users, (packed) => {
            const status = UserLogic.unpack(database, packed, logger);
            if (!status.ok()) {
                load_users_problems.push(status);
            }
            return status.value;
        });

        const runtime = new Runtime(database, config, runtime_hash, users, logger);
        return Status.ok_and_warnings("loading users", load_users_problems)
                     .with(runtime);
    }

    private async on_user_added(user: UserLogic, startup: boolean): Promise<void> {
        if (!user.is_guest()) {
            if (this.deposits_fetcher) {
                user.attach_deposit_fetcher(this.deposits_fetcher);
            }
        }

        // Notify admins:
        if (!startup) {
            this.admin_panel.send_notification(
                `User ${user.data.name} ${user.data.surname} (@${user.data.tgid}) has joined`);
        }
    }

    private async send_backup_to_admins(): Promise<void> {
        const runtime_data = JSON.stringify(Runtime.pack(this));
        const runtime_hash = crypto.createHash("sha256").update(runtime_data).digest("hex");

        this.logger.info(`Sending runtime backup, hash: ${runtime_hash}`);
        this.last_backup = {
            hash: runtime_hash,
            time: new Date(),
        };
        this.admin_panel.send_runtime_backup_to_admins();
    }
}

function log_message(logger: pino.Logger, msg: TelegramBot.Message) {
    if (msg.text) {
        if (!msg.text.includes("\n")) {
            logger.info(`Message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);
        } else {
            logger.info([
                `Message from ${msg.from?.username} in ${msg.chat.id}:`,
                msg.text,
            ].join("\n"));
        }
    } else {
        logger.info(`Empty message from ${msg.from?.username} in ${msg.chat.id}`);
    }
}


function update_packed_runtime(old_version: number, database: Database, data: any, logger: pino.Logger): ReturnType<typeof Runtime.pack> {
    switch (old_version) {
        case 1:
            const status = update_runtime_v1(database, data, logger);
            if (!status.ok()) {
                throw status;
            }
            data = status.value;
            // no break!
    }
    return data;
}

// Update from v1 to v2
function update_runtime_v1(database: Database, data: any, logger: pino.Logger): StatusWith<any> {
    try {
        // in version 1 users were stored as map of user_id: number -> user_logic
        // in version 2 key was replaced with tgid: string
        const users = unpack_map(data.users, (packed) => {
            const status = UserLogic.unpack(database, packed as any, logger);
            if (!status.ok()) {
                throw status;
            }
            return status.value;
        }) as Map<number, UserLogic>;

        const new_users = new Map([...users.values()].map(user => [user.data.tgid, user]));
        data.users = pack_map(new_users, UserLogic.pack);
        data.version = 2;
        return Status.ok().with(data);
    } catch (e) {
        return return_exception(e, logger, "Failed to unpack users");
    }
}

