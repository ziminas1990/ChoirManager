import fs from "fs";
import crypto from "crypto";

import { Status, StatusWith } from "@src/status.js";
import { Database, Language, Role, User, Voice } from "./database.js";
import { UserLogic } from "./logic/user.js";
import { pack_map, return_exception, unpack_map } from "./utils.js";
import { DepositsFetcher } from "./fetchers/deposits_fetcher.js";
import { Config } from "./config.js";
import { Proceeder } from "./logic/abstracts.js";
import { DocumentsFetcher } from "./fetchers/document_fetcher.js";
import { ChoristerAssistant } from "./ai_assistants/chorister_assistant.js";
import { UsersFetcher } from "./fetchers/users_fetcher.js";
import { ScoresFetcher } from "./fetchers/scores_fetcher.js";
import { Journal } from "./journal.js";
import { AdminActions } from "./use_cases/admin_actions.js";
import { IFeedbackStorage } from "./interfaces/feedback_storage.js";
import { FeedbackStorageFactory } from "./adapters/feedback_storage/factory.js";
import { TgAdapter } from "./adapters/telegram/adapter.js";
import { update_v2_v3 } from "./configuration/update_v2_v3.js";
import { IAdapter } from "./interfaces/adapter.js";
import { IRehersalsStorage } from "./interfaces/rehersals_storage.js";
import { RehersalsStorageFactory } from "./adapters/rehersals_storage/factory.js";
import { RehersalsTracker } from "./logic/rehersals_tracker.js";

export class Runtime {

    private static instance?: Runtime;

    static Load(database: Database, parent_journal: Journal): StatusWith<Runtime> {
        const journal = parent_journal.child("rt");
        try {
            const packed = JSON.parse(fs.readFileSync(
                Config.data.runtime_cache_filename,
                "utf8"
            ));
            return Runtime.unpack(database, packed, journal);
        } catch (e) {
            const empty_runtime = new Runtime(database, "", new Map(), journal);
            return StatusWith.ok().with(empty_runtime);
        }
    }

    private started_at: Date = new Date();

    private next_dump: Date = new Date();
    private update_interval_sec: number = 0;
    private users_fetcher?: UsersFetcher;
    private deposits_fetcher?: DepositsFetcher;
    private documents_fetcher?: DocumentsFetcher;
    private scores_fetcher?: ScoresFetcher;
    private feedback_storage?: IFeedbackStorage;
    private rehersals_storage?: IRehersalsStorage;

    private rehersals_tracker?: RehersalsTracker;

    private tg_adapter?: TgAdapter;

    // We need a separate proceeder for each user to guarantee that all users will
    // be proceeded independently, so that if some user stuck in it's proceed() due to
    // some lokng operation, it won't affect another users
    private user_proceeders: Map<UserLogic, Proceeder<void>> = new Map();

    private last_backup: {
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
        private runtime_hash: string,
        private users: Map<string, UserLogic>,
        private journal: Journal,
        private guest_users: Map<string, UserLogic> = new Map())
    {
        if (Runtime.instance) {
            throw new Error("Runtime is already initialized");
        }
        Runtime.instance = this;

        this.last_backup = {
            hash: runtime_hash,
            time: new Date(),
        };
    }

    running_time_sec(): number {
        return Math.floor((new Date().getTime() - this.started_at.getTime()) / 1000);
    }

    async start(): Promise<Status> {
        this.journal.log().info("Starting runtime");

        if (Config.HasTgAdapter()) {
            this.journal.log().info("Starting Telegram adapter");
            if (!this.tg_adapter) {
                this.tg_adapter = new TgAdapter(Config.TgAdapter(), this.journal);
            }
            const status = await this.tg_adapter.init();
            if (!status.ok()) {
                return status.wrap("Failed to start Telegram adapter");
            }
        }

        if (Config.HasDepoditTracker()) {
            this.journal.log().info("Starting deposits fetcher");
            this.deposits_fetcher = new DepositsFetcher();
            const deposits_status = await this.deposits_fetcher.start();
            if (!deposits_status.ok()) {
                return deposits_status.wrap("Failed to start deposits fetcher");
            }
        }

        if (Config.HasAssistant()) {
            this.journal.log().info("Starting AI assistant");
            this.documents_fetcher = new DocumentsFetcher(Config.Assistant().fetch_interval_sec);
            const documents_status = await this.documents_fetcher.start();
            if (!documents_status.ok()) {
                return documents_status.wrap("Failed to start documents fetcher");
            }
            ChoristerAssistant.init(this.documents_fetcher, this.journal.child("assistant"));
        }

        if (Config.HasScoresFetcher()) {
            this.journal.log().info("Starting scores fetcher");
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

        await AdminActions.notify_all_admins(
            "Bot has been restarted",
            this.journal
        );

        if (Config.data.feedback_storage) {
            this.journal.log().info("Initializing feedback storage...");
            let status = FeedbackStorageFactory.create(
                Config.data.feedback_storage, this.journal);
            if (!status.ok() || !status.value) {
                return status.wrap("Failed to create feedback storage");
            }
            this.feedback_storage = status.value;
            status = await this.feedback_storage.init();
            if (!status.ok()) {
                return status.wrap("Failed to initialize feedback storage");
            }
        }

        if (Config.data.rehersals_storage) {
            this.journal.log().info("Initializing rehersals storage...");
            let status = RehersalsStorageFactory.create(Config.data.rehersals_storage);
            if (!status.ok() || !status.value) {
                return status.wrap("Failed to create rehersals storage");
            }
            this.rehersals_storage = status.value;
            status = await this.rehersals_storage.init();
            if (!status.ok()) {
                return status.wrap("Failed to initialize rehersals storage");
            }
            this.rehersals_tracker = new RehersalsTracker(
                this.rehersals_storage, this.database, this.journal);
            status = await this.rehersals_tracker.init();
            if (!status.ok()) {
                return status.wrap("Failed to initialize rehersals tracker");
            }
        }

        return Status.ok();
    }

    get_users(filter?: (user: UserLogic) => boolean): UserLogic[] {
        const all = Array.from(this.users.values());
        if (filter) {
            return all.filter(filter);
        }
        return all;
    }

    get_database(): Database {
        return this.database;
    }

    get_feedback_storage(): IFeedbackStorage | undefined {
        return this.feedback_storage;
    }

    attach_users_fetcher(fetcher: UsersFetcher): void {
        this.users_fetcher = fetcher;
    }

    get_user(tg_id: string, create_guest: boolean = false): UserLogic | undefined {
        const user = this.database.get_user(tg_id);
        if (user) {
            let user_logic = this.users.get(user.tgid);
            if (!user_logic) {
                user_logic = new UserLogic(user, 100, this.journal);
                this.users.set(user.tgid, user_logic);
                this.on_user_added(user_logic, false);
            }
            return user_logic;
        }
        if (create_guest) {
            return this.get_guest_user(tg_id);
        }
        return undefined;
    }

    get_guest_user(tg_id: string): UserLogic {
        let user = this.guest_users.get(tg_id);
        if (user == undefined) {
            user = new UserLogic(
                new User(tg_id, "guest", "", Language.RU, Voice.Unknown, [Role.Guest]),
                500,
                this.journal);
            this.guest_users.set(tg_id, user);
            this.on_user_added(user, false);
        }
        return user;
    }

    all_users(): IterableIterator<UserLogic> {
        return this.users.values();
    }

    get_adapters(): IAdapter[] {
        const adapters: (IAdapter | undefined)[] = [
            this.tg_adapter,
        ];
        return adapters.filter((adapter) => adapter != undefined) as IAdapter[];
    }

    async proceed(now: Date): Promise<Status> {

        if (this.tg_adapter) {
            const status = await this.tg_adapter.proceed(now);
            if (!status.ok()) {
                this.journal.log().error(`Tg adapter proceed failed: ${status.what()}`);
            }
        }

        if (this.users_fetcher) {
            const users_status = await this.users_fetcher.proceed();
            if (!users_status.ok()) {
                this.journal.log().error(`Users fetcher proceed failed: ${users_status.what()}`);
            }
        }

        if (this.deposits_fetcher) {
            const deposits_status = await this.deposits_fetcher.proceed();
            if (!deposits_status.ok()) {
                this.journal.log().error(`Deposits fetcher proceed failed: ${deposits_status.what()}`);
            }
        }

        if (this.rehersals_tracker) {
            const rehersals_status = await this.rehersals_tracker.proceed(now);
            if (!rehersals_status.ok()) {
                this.journal.log().error(`Rehersals tracker proceed failed: ${rehersals_status.what()}`);
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
            const runtime_hash = this.do_backup();
            this.next_dump = new Date(Date.now() + this.update_interval_sec * 1000);

            // Send runtime backup to admins (not more than once a day)
            if (this.last_backup.hash != runtime_hash) {
                const time_diff = new Date().getTime() - this.last_backup.time.getTime();
                if (time_diff > 24 * 60 * 60 * 1000) {
                    for (const user of this.all_users()) {
                        if (user.is_admin()) {
                            await AdminActions.send_runtime_backup(user.data, this.journal);
                        }
                    }
                    this.last_backup = {
                        hash: runtime_hash,
                        time: new Date(),
                    }
                }
            }
        }
        return Status.ok();
    }

    // Return hash
    do_backup(): string {
        const runtime_data = JSON.stringify(Runtime.pack(this), null, 2);
        const runtime_hash = crypto.createHash("sha256").update(runtime_data).digest("hex");

        if (runtime_hash != this.runtime_hash) {
            this.journal.log().info(`Updating runtime, hash: ${runtime_hash}`);
            fs.writeFileSync(Config.data.runtime_cache_filename, runtime_data);
            this.runtime_hash = runtime_hash;
        }
        return runtime_hash;
    }

    static pack(runtime: Runtime) {
        return {
            version: 3,
            tg_adapter: runtime.tg_adapter ? TgAdapter.pack(runtime.tg_adapter) : undefined,
            users: pack_map(runtime.users, UserLogic.pack)
        } as const;
    }

    static unpack(database: Database, packed: ReturnType<typeof Runtime.pack>, journal: Journal)
    : StatusWith<Runtime>
    {
        const runtime_hash = crypto.createHash("sha256").update(JSON.stringify(packed)).digest("hex");

        if (packed.version != 3) {
            const old_version: number = packed.version == "1.0" ? 1 : packed.version;
            try {
                packed = update_packed_runtime(old_version, packed);
            } catch (e) {
                return return_exception(e, journal.log(), "failed to update runtime data");
            }
        }

        const load_users_problems: Status[] = [];
        const users = unpack_map(packed.users, (packed) => {
            const status = UserLogic.unpack(database, packed, journal);
            if (!status.ok()) {
                load_users_problems.push(status);
            }
            return status.value;
        });

        const runtime = new Runtime(database, runtime_hash, users, journal);

        if (packed.tg_adapter) {
            runtime.tg_adapter = TgAdapter.unpack(
                Config.data.tg_adapter, packed.tg_adapter, journal);
        }

        return Status.ok_and_warnings("loading users", load_users_problems)
                     .with(runtime);
    }

    private async on_user_added(user: UserLogic, startup: boolean): Promise<void> {
        if (this.deposits_fetcher) {
            user.attach_deposit_fetcher(this.deposits_fetcher);
        }

        // Notify admins:
        if (!startup) {
            const name = user.data.name.length > 0 ? user.data.name : "guest";
            AdminActions.notify_all_admins(
                `User ${name} ${user.data.surname} (@${user.data.tgid}) has joined`,
                this.journal);
        }
    }
}


function update_packed_runtime(old_version: number, data: any)
: ReturnType<typeof Runtime.pack> {
    if (old_version == 1) {
        throw new Error("Exporting from version 1 is not supported");
    }
    if (old_version == 2) {
        data = update_v2_v3(data);
    }
    return data;
}