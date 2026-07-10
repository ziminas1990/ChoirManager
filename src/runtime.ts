import fs from "fs";
import crypto from "crypto";
import path from "path";

import { BotConfig } from "./config.js";
import { Expected, Status } from "@src/utils/expected.js";
import { Database, Language, Role, User, Voice } from "./database.js";
import { UserLogic } from "./logic/user.js";
import { pack_map, return_exception, unpack_map } from "./utils.js";
import { DepositsFetcher } from "./fetchers/deposits_fetcher.js";
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
import { TaskTrackerFactory } from "./adapters/task_tracker/factory.js";
import { update_v2_v3 } from "./configuration/update_v2_v3.js";
import { IAdapter } from "./interfaces/adapter.js";
import { IRehersalsStorage } from "./interfaces/rehersals_storage.js";
import { RehersalsStorageFactory } from "./adapters/rehersals_storage/factory.js";
import { RehersalsTracker } from "./logic/rehersals_tracker.js";
import { GoogleSpreadsheetMessagesProvider } from "./adapters/messages_provider/google_spreadsheet.js";
import { MessagesStorageFactory } from "./adapters/messages_storage/factory.js";
import { LocalBroadcaster } from "./adapters/local_message_queue/local_broadcaster.js";
import { GroupChat } from "./logic/group_chat.js";
import { ITransactionsStorage } from "./interfaces/transactions_storage.js";
import { TransactionStorageFactory } from "./adapters/transactions_storage/factory.js";
import { NewRecordsFetcher } from "./fetchers/new_records_fetcher.js";
import { AttendanceTracker } from "./logic/attendance_tracker.js";
import { TaskTracker, TaskTrackerEvent } from "./logic/task_tracker.js";
import { ManagersAgent } from "./logic/managers_agent.js";
import { TaskTrackerTools } from "./components/ai/tools/task_tracker_tools.js";

export type RuntimeConfigJson = {
    runtime_cache_filename: string;
    runtime_dump_interval_sec: number;
    logs_file: string;
}

export class RuntimeConfig {
    constructor(private readonly json: RuntimeConfigJson) {}

    get runtime_cache_filename(): string {
        return this.json.runtime_cache_filename;
    }

    get runtime_dump_interval_sec(): number {
        return this.json.runtime_dump_interval_sec;
    }

    get logs_file(): string {
        return this.json.logs_file;
    }

    verify(): Status {
        if (!this.json.runtime_cache_filename) {
            return Expected.err("'runtime_cache_filename' MUST be specified");
        }
        if (!this.json.logs_file) {
            return Expected.err("'logs_file' MUST be specified");
        }
        if (!this.json.runtime_dump_interval_sec) {
            return Expected.err("'runtime_dump_interval_sec' MUST be specified");
        }
        if (this.json.runtime_dump_interval_sec < 0) {
            return Expected.err("'runtime_dump_interval_sec' MUST be positive");
        }
        return Expected.ok(undefined);
    }
}

export class Runtime {

    private static instance?: Runtime;

    static Load(config: BotConfig, database: Database, parent_journal: Journal): Expected<Runtime> {
        const journal = parent_journal.child("rt");
        const runtime_cache_filename = path.resolve(config.runtime.runtime_cache_filename);
        try {
            journal.log().info({ runtime_cache_filename }, "Reading runtime cache");
            const packed_raw = fs.readFileSync(runtime_cache_filename, "utf8");
            journal.log().info({
                runtime_cache_filename,
                bytes: Buffer.byteLength(packed_raw, "utf8"),
            }, "Runtime cache read");

            const packed = JSON.parse(packed_raw);
            const runtime = Runtime.unpack(config, database, packed, journal);
            if (!runtime.ok) {
                journal.log().error({
                    runtime_cache_filename,
                    error: runtime.error,
                }, "Failed to unpack runtime cache");
            }
            return runtime;
        } catch (e) {
            journal.log().error({
                runtime_cache_filename,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            }, "Failed to load runtime cache, falling back to empty runtime");
            const empty_runtime = new Runtime(config, database, "", new Map(), journal);
            return Expected.ok(empty_runtime);
        }
    }

    private started_at: Date = new Date();

    private next_dump: Date = new Date();
    private update_interval_sec: number = 0;
    private users_fetcher?: UsersFetcher;
    private deposits_fetcher?: DepositsFetcher;
    private documents_fetcher?: DocumentsFetcher;
    private scores_fetcher?: ScoresFetcher;
    private new_records_fetcher?: NewRecordsFetcher;
    private feedback_storage?: IFeedbackStorage;
    private rehersals_storage?: IRehersalsStorage;
    private transactions_storage?: ITransactionsStorage;

    private managers_chat?: GroupChat;
    private managers_agent?: ManagersAgent;
    private announce_chat?: GroupChat;
    private readonly task_tracker_broadcaster = new LocalBroadcaster<TaskTrackerEvent>();

    private messages_provider?: GoogleSpreadsheetMessagesProvider;
    private attendance_tracker?: AttendanceTracker;
    private rehersals_tracker?: RehersalsTracker;
    private task_tracker?: TaskTracker;

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
        private readonly config: BotConfig,
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

        if (this.config.tg_adapter) {
            this.journal.log().info("Starting Telegram adapter");
            if (!this.tg_adapter) {
                this.tg_adapter = new TgAdapter(this.config.tg_adapter, {
                    deposit_tracking: this.config.deposit_tracking,
                    runtime: this.config.runtime,
                }, this.journal);
            }
            const status = await this.tg_adapter.init();
            if (!status.ok) {
                return status.wrap_error("Failed to start Telegram adapter");
            }
        }

        if (this.config.deposit_tracking) {
            this.journal.log().info("Starting deposits fetcher");
            this.deposits_fetcher = new DepositsFetcher(this.config.deposit_tracking);
            const deposits_status = await this.deposits_fetcher.start();
            if (!deposits_status.ok) {
                return deposits_status.wrap_error("Failed to start deposits fetcher");
            }
        }

        if (this.config.assistant) {
            this.journal.log().info("Starting AI assistant");
            this.documents_fetcher = new DocumentsFetcher(this.config.assistant);
            const documents_status = await this.documents_fetcher.start();
            if (!documents_status.ok) {
                return documents_status.wrap_error("Failed to start documents fetcher");
            }
            ChoristerAssistant.init(
                this.config.assistant,
                this.documents_fetcher,
                this.journal.child("assistant")
            );
        }

        if (this.config.scores_fetcher) {
            this.journal.log().info("Starting scores fetcher");
            this.scores_fetcher = new ScoresFetcher(this.config.scores_fetcher, this.database);
            const scores_status = await this.scores_fetcher.start();
            if (!scores_status.ok) {
                return scores_status.wrap_error("Failed to start scores fetcher");
            }
        }

        if (this.config.new_records_tracker) {
            this.journal.log().info("Starting new records tracker");
            if (!this.new_records_fetcher) {
                this.new_records_fetcher = new NewRecordsFetcher(
                    this.journal,
                    this.config.new_records_tracker,
                    () => this.get_adapters(),
                );
            }
            const new_records_status = await this.new_records_fetcher.start();
            if (!new_records_status.ok) {
                return new_records_status.wrap_error("Failed to start new records tracker");
            }
        }

        this.journal.log().info("Initializing messages provider...");
        this.messages_provider = new GoogleSpreadsheetMessagesProvider(
            this.config.messages_provider!.sheet_id,
            this.config.messages_provider!.table_name,
            this.journal,
        );
        const messages_provider_status = await this.messages_provider.init();
        if (!messages_provider_status.ok) {
            return messages_provider_status.wrap_error("Failed to initialize messages provider");
        }

        this.update_interval_sec = this.config.runtime.runtime_dump_interval_sec;
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

        if (this.config.json.feedback_storage) {
            this.journal.log().info("Initializing feedback storage...");
            const create_status = FeedbackStorageFactory.create(
                this.config.json.feedback_storage, this.journal);
            if (!create_status.ok) {
                return create_status.wrap_error("Failed to create feedback storage");
            }
            this.feedback_storage = create_status.value;
            const init_status = await this.feedback_storage.init();
            if (!init_status.ok) {
                return init_status.wrap_error("Failed to initialize feedback storage");
            }
        }

        if (this.config.json.transaction_storage) {
            this.journal.log().info("Initializing transaction storage...");
            let status = TransactionStorageFactory.create(this.config.json.transaction_storage);
            if (!status.ok) {
                return status.wrap_error("Failed to create transaction storage");
            }
            this.transactions_storage = status.value;
        }

        if (this.config.json.rehersals_storage) {
            this.journal.log().info("Initializing rehersals storage...");
            const create_status = RehersalsStorageFactory.create(this.config.json.rehersals_storage);
            if (!create_status.ok) {
                return create_status.wrap_error("Failed to create rehersals storage");
            }
            this.rehersals_storage = create_status.value;
            const init_status = await this.rehersals_storage.init();
            if (!init_status.ok) {
                return init_status.wrap_error("Failed to initialize rehersals storage");
            }
            this.rehersals_tracker = new RehersalsTracker(
                this.config.rehersals_tracker!,
                this.rehersals_storage,
                this.database,
                this.journal
            );
            const tracker_status = await this.rehersals_tracker.init();
            if (!tracker_status.ok) {
                return tracker_status.wrap_error("Failed to initialize rehersals tracker");
            }
        }

        if (this.config.attendance_tracker) {
            this.journal.log().info("Initializing attendance tracker...");
            this.attendance_tracker = new AttendanceTracker(
                this.config.attendance_tracker,
                this.messages_provider,
                this.database,
                (tgid) => this.get_user(tgid),
                async () => await this.tg_adapter?.get_managers_chat(),
                this.journal
            );
            const attendance_status = await this.attendance_tracker.init();
            if (!attendance_status.ok) {
                return attendance_status.wrap_error("Failed to initialize attendance tracker");
            }
        }

        if (this.config.task_tracker) {
            this.journal.log().info("Initializing task tracker...");
            const create_status = TaskTrackerFactory.create(
                this.config.task_tracker.database,
                this.journal,
            );
            if (!create_status.ok) {
                return create_status.wrap_error("Failed to create task tracker");
            }
            this.task_tracker = new TaskTracker(
                this.config.task_tracker,
                create_status.value,
                this.task_tracker_broadcaster,
                this.journal,
            );
            const init_status = await this.task_tracker.init();
            if (!init_status.ok) {
                return init_status.wrap_error("Failed to initialize task tracker");
            }
        }

        if (this.config.json.managers_chat) {
            this.journal.log().info("Initializing managers chat...");
            this.managers_chat = new GroupChat(this.journal);
            if (this.config.json.managers_chat.backlog) {
                const backlog = MessagesStorageFactory.create(this.config.json.managers_chat.backlog);
                if (!backlog.ok) {
                    return backlog.wrap_error("Failed to create managers chat backlog");
                }
                const status = await backlog.value.init();
                if (!status.ok) {
                    return status.wrap_error("Failed to initialize managers chat backlog");
                }
                this.managers_chat.attach_to_backlog(backlog.value);
            }
        }

        if (this.config.managers_chat_agent && this.managers_chat) {
            this.journal.log().info("Initializing managers chat agent...");
            const task_tracker_tools = this.task_tracker
                ? new TaskTrackerTools(
                    (filter) => this.task_tracker!.get_tasks(filter),
                    (task) => this.task_tracker!.create_task(task),
                    (task) => this.task_tracker!.update_task(task),
                    (task) => this.task_tracker!.delete_task(task),
                )
                : undefined;
            this.managers_agent = new ManagersAgent(
                this.config.managers_chat_agent,
                this.managers_chat,
                this.task_tracker_broadcaster,
                {
                    get_managers_chat: async () => {
                        return await this.tg_adapter?.get_managers_chat();
                    },
                    resolve_author: (user_id) => {
                        if (user_id === this.config.tg_adapter?.bot_id) {
                            return "Ursa Major Bot";
                        }
                        const user = this.get_user(user_id);
                        if (!user) {
                            return `@${user_id}`;
                        }
                        const name = [user.data.name, user.data.surname]
                            .filter(part => part.length > 0)
                            .join(" ");
                        const username = user.data.tgid ? ` (@${user.data.tgid})` : "";
                        return `${name.length > 0 ? name : user_id}${username}`;
                    },
                    bot_id: this.config.tg_adapter!.bot_id!,
                },
                task_tracker_tools,
                this.journal,
            );
            const init_status = await this.managers_agent.init();
            if (!init_status.ok) {
                return init_status.wrap_error("Failed to initialize managers chat agent");
            }
        }

        if (this.config.json.announce_chat) {
            this.journal.log().info("Initializing announce chat...");
            this.announce_chat = new GroupChat(this.journal);
            if (this.config.json.announce_chat.backlog) {
                const backlog = MessagesStorageFactory.create(this.config.json.announce_chat.backlog);
                if (!backlog.ok) {
                    return backlog.wrap_error("Failed to create announce chat backlog");
                }
                const status = await backlog.value.init();
                if (!status.ok) {
                    return status.wrap_error("Failed to initialize announce chat backlog");
                }
                this.announce_chat.attach_to_backlog(backlog.value);
            }
        }

        return Expected.ok(undefined);
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

    get_transactions_storage(): ITransactionsStorage | undefined {
        return this.transactions_storage;
    }

    get_managers_chat(): GroupChat | undefined {
        return this.managers_chat;
    }

    get_managers_agent(): ManagersAgent | undefined {
        return this.managers_agent;
    }

    get_announce_chat(): GroupChat | undefined {
        return this.announce_chat;
    }

    attach_users_fetcher(fetcher: UsersFetcher): void {
        this.users_fetcher = fetcher;
    }

    get_user(tg_id: string, create_guest: boolean = false): UserLogic | undefined {
        const user = this.database.get_user(tg_id);
        if (user) {
            let user_logic = this.users.get(user.tgid);
            if (!user_logic) {
                user_logic = new UserLogic(user, 100, this.journal, this.config.deposit_tracking);
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
                this.journal,
                this.config.deposit_tracking,
            );
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
            if (!status.ok) {
                this.journal.log().error(`Tg adapter proceed failed: ${status.error}`);
            }
        }

        if (this.users_fetcher) {
            const users_status = await this.users_fetcher.proceed();
            if (!users_status.ok) {
                this.journal.log().error(`Users fetcher proceed failed: ${users_status.error}`);
            }
        }

        if (this.deposits_fetcher) {
            const deposits_status = await this.deposits_fetcher.proceed();
            if (!deposits_status.ok) {
                this.journal.log().error(`Deposits fetcher proceed failed: ${deposits_status.error}`);
            }
        }

        if (this.rehersals_tracker) {
            const rehersals_status = await this.rehersals_tracker.proceed(now);
            if (!rehersals_status.ok) {
                this.journal.log().error(`Rehersals tracker proceed failed: ${rehersals_status.error}`);
            }
        }

        if (this.messages_provider) {
            const messages_provider_status = await this.messages_provider.proceed();
            if (!messages_provider_status.ok) {
                this.journal.log().error(`Messages provider proceed failed: ${messages_provider_status.error}`);
            }
        }

        if (this.attendance_tracker) {
            const attendance_status = await this.attendance_tracker.proceed(now);
            if (!attendance_status.ok) {
                this.journal.log().error(`Attendance tracker proceed failed: ${attendance_status.error}`);
            }
        }

        if (this.task_tracker) {
            const task_tracker_status = await this.task_tracker.proceed(now);
            if (!task_tracker_status.ok) {
                this.journal.log().error(`Task tracker proceed failed: ${task_tracker_status.error}`);
            }
        }

        if (this.scores_fetcher) {
            const scores_status = await this.scores_fetcher.proceed();
            if (!scores_status.ok) {
                this.journal.log().error(`Scores fetcher proceed failed: ${scores_status.error}`);
            }
        }

        if (this.new_records_fetcher) {
            const new_records_status = await this.new_records_fetcher.proceed();
            if (!new_records_status.ok) {
                this.journal.log().error(`New records tracker proceed failed: ${new_records_status.error}`);
            }
        }

        if (this.managers_chat) {
            const managers_status = await this.managers_chat.proceed(now);
            if (!managers_status.ok) {
                this.journal.log().error(`Managers chat proceed failed: ${managers_status.error}`);
            }
        }

        if (this.managers_agent) {
            const managers_agent_status = await this.managers_agent.proceed();
            if (!managers_agent_status.ok) {
                this.journal.log().error(`Managers agent proceed failed: ${managers_agent_status.error}`);
            }
        }

        if (this.announce_chat) {
            const announce_status = await this.announce_chat.proceed(now);
            if (!announce_status.ok) {
                this.journal.log().error(`Announce chat proceed failed: ${announce_status.error}`);
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
                            await AdminActions.send_runtime_backup(user.data, this.config.runtime, this.journal);
                        }
                    }
                    this.last_backup = {
                        hash: runtime_hash,
                        time: new Date(),
                    }
                }
            }
        }
        return Expected.ok(undefined);
    }

    // Return hash
    do_backup(): string {
        const runtime_data = JSON.stringify(Runtime.pack(this), null, 2);
        const runtime_hash = crypto.createHash("sha256").update(runtime_data).digest("hex");
        const runtime_cache_filename = path.resolve(this.config.runtime.runtime_cache_filename);
        const bytes = Buffer.byteLength(runtime_data, "utf8");

        if (runtime_hash != this.runtime_hash) {
            this.journal.log().info({
                runtime_cache_filename,
                bytes,
                hash: runtime_hash,
            }, "Writing runtime dump");
            fs.writeFileSync(runtime_cache_filename, runtime_data);
            this.journal.log().info({
                runtime_cache_filename,
                bytes,
                hash: runtime_hash,
            }, "Runtime dump written");
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

    static unpack(
        config: BotConfig,
        database: Database,
        packed: ReturnType<typeof Runtime.pack>,
        journal: Journal
    )
    : Expected<Runtime>
    {
        const runtime_hash = crypto.createHash("sha256").update(JSON.stringify(packed)).digest("hex");

        if (packed.version != 3) {
            const old_version: number = packed.version == "1.0" ? 1 : packed.version;
            try {
                packed = update_packed_runtime(old_version, packed);
            } catch (e) {
                return return_exception<Runtime>(e, journal.log(), "failed to update runtime data");
            }
        }

        const users = unpack_map(packed.users, (packed) => {
            const status = UserLogic.unpack(database, packed, config.deposit_tracking, journal);
            if (!status.ok) {
                journal.log().warn(`loading users: ${status.error}`);
                return undefined;
            }
            return status.value;
        });

        const runtime = new Runtime(config, database, runtime_hash, users, journal);

        if (packed.tg_adapter && config.tg_adapter) {
            runtime.tg_adapter = TgAdapter.unpack(
                config.tg_adapter,
                {
                    deposit_tracking: config.deposit_tracking,
                    runtime: config.runtime,
                },
                packed.tg_adapter,
                journal,
            );
        }

        return Expected.ok(runtime);
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