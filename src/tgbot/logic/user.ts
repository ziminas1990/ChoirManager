import TelegramBot from 'node-telegram-bot-api';
import fs from "fs";

import { Logic } from './abstracts.js';
import { Dialog } from './dialog.js';
import { Database, Role, User } from '../database.js';
import { Status, StatusWith } from '../../status.js';
import { DepositsFetcher } from '../fetchers/deposits_fetcher.js';
import { DepositsTracker, DepositsTrackerEvent } from './deposits_tracker.js';
import { DepositActivity } from '../activities/deposit_activity.js';
import { BotAPI } from '../api/telegram.js';
import { Config } from '../config.js';
import { ChoristerAssistant } from '../ai_assistants/chorister_assistant.js';
import { DocumentsFetcher } from '../fetchers/document_fetcher.js';
import { OpenaiAPI } from '../api/openai.js';
import { Journal } from "../journal.js";
import { return_exception, return_fail } from '../utils.js';
import { TelegramCallbacks } from '../api/tg_callbacks.js';

export class UserLogic extends Logic<void> {
    private dialog?: Dialog;
    private messages_queue: TelegramBot.Message[] = [];
    private last_activity?: Date;
    private deposit_tracker: DepositsTracker;
    private deposit_activity: DepositActivity;
    private journal: Journal;

    private callbacks: TelegramCallbacks;

    private chorister_assustant?: ChoristerAssistant

    constructor(
        public readonly data: User,
        proceed_interval_ms: number,
        parent_journal: Journal)
    {
        super(proceed_interval_ms);
        this.last_activity = new Date();

        const additional_tags: Record<string, any> = {};
        if (this.is_guest()) {
            additional_tags.role = "guest";
        }

        this.journal = parent_journal.child(`@${data.tgid}`, additional_tags);
        this.deposit_activity = new DepositActivity(this.journal);

        this.callbacks = new TelegramCallbacks(this.journal.child("callbacks"));

        this.deposit_tracker = new DepositsTracker(this.data.tgid, this.journal);

        if (this.is_accountant()) {
            DepositActivity.add_accountant(this);
        }
    }

    get_journal(): Journal {
        return this.journal;
    }

    callbacks_registry(): TelegramCallbacks {
        return this.callbacks;
    }

    attach_deposit_fetcher(fetcher: DepositsFetcher): void {
        this.deposit_tracker.attach_deposit_fetcher(fetcher);
    }

    attach_documents_fetcher(fetcher: DocumentsFetcher) {
        if (OpenaiAPI.is_available()) {
            const journal = this.journal.child("chorister");
            this.chorister_assustant = new ChoristerAssistant(fetcher, journal);
        }
    }

    is_guest(): boolean {
        return this.data.is(Role.Guest);
    }

    is_admin(): boolean {
        return this.data.is(Role.Admin);
    }

    is_accountant(): boolean {
        return this.data.is(Role.Accountant)
    }

    is_member(): boolean {
        return this.data.is(Role.Chorister) || this.data.is(Role.Conductor);
    }

    is_chorister(): boolean {
        return this.data.is(Role.Chorister);
    }

    is_ex_chorister(): boolean {
        return this.data.is(Role.ExChorister);
    }

    main_dialog(): Dialog | undefined {
        return this.dialog;
    }

    on_message(msg: TelegramBot.Message): Status {
        this.last_activity = new Date();
        if (msg.chat.type !== "private") {
            return return_fail("Message is not from a private chat", this.journal.log());
        }
        this.messages_queue.push(msg);
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        this.last_activity = new Date();
        const callback_id = query.data;
        if (!callback_id) {
            return return_fail("callback_id is undefined", this.journal.log());
        }
        return this.callbacks.on_callback(query);
    }

    get_last_activity() {
        return this.last_activity;
    }

    get_chorister_assistant(): ChoristerAssistant | undefined {
        return this.chorister_assustant;
    }

    async send_deposit_info(): Promise<Status> {
        if (!this.dialog) {
            return return_fail("no active dialog", this.journal.log());
        }

        const deposit_info = this.deposit_tracker.get_deposit()
        if (deposit_info) {
            return await this.deposit_activity.send_deposit_info(deposit_info, this.dialog);
        } else {
            this.dialog?.send_message("Error: no deposit info available")
            return return_fail("no deposit info available", this.journal.log());
        }
    }

    async proceed_impl(now: Date): Promise<Status> {
        let status = await this.proceed_messages_queue();
        if (!status.ok()) {
            return status.wrap("can't proceed messages queue");
        }

        const warnings: Status[] = [];

        if (this.dialog) {
            const status = await this.dialog.proceed(now);
            if (!status.ok()) {
                warnings.push(status.wrap("dialog proceeding"))
            }
        }

        {
            const events = await this.deposit_tracker.proceed(now);
            if (!events.ok()) {
                warnings.push(events.wrap("deposit_tracker"));
            }
            for (const event of events.value ?? []) {
                await this.handle_deposit_tracker_event(event);
            }
        }

        status = await this.callbacks.proceed(now);
        if (!status.ok()) {
            warnings.push(status.wrap("callbacks"));
        }

        return Status.ok_and_warnings("dialog proceed", warnings);
    }

    async send_runtime_backup(): Promise<Status> {
        if (!this.dialog) {
            return return_fail("no active dialog", this.journal.log());
        }
        if (!this.is_admin()) {
            return return_fail("not an admin", this.journal.log());
        }

        try {
            await BotAPI.instance().sendDocument(
                this.dialog.chat_id,
                fs.createReadStream(Config.data.runtime_cache_filename),
                undefined,
                { contentType: "application/json" }
            );
        } catch (error) {
            return return_exception(error, this.journal.log(), "failed to send runtime backup");
        }
        return Status.ok();
    }

    static pack(user: UserLogic) {
        return {
            "tgid": user.data.tgid,
            "dlg": user.dialog ? Dialog.pack(user.dialog) : undefined,
            "deposit_tracker": DepositsTracker.pack(user.deposit_tracker)
        } as const;
    }

    static unpack(
        database: Database,
        packed: ReturnType<typeof UserLogic.pack>,
        parent_journal: Journal
    ): StatusWith<UserLogic> {
        const [tgid, dialog] = [packed.tgid, packed.dlg];

        const user = tgid ? database.get_user(tgid) : undefined;
        if (!user) {
            return StatusWith.fail(`User @${tgid} not found`);
        }
        const logic = new UserLogic(user, 100, parent_journal);

        // Load dialogs
        const unpack_dialog_status: StatusWith<Dialog> =
            dialog ? Dialog.unpack(logic, dialog) : Status.ok();
        if (unpack_dialog_status.ok()) {
            logic.dialog = unpack_dialog_status.value!;
        }

        if (packed.deposit_tracker) {
            logic.deposit_tracker = DepositsTracker.unpack(tgid, packed.deposit_tracker, parent_journal);
        }

        return Status.ok_and_warnings("unpacking", [unpack_dialog_status]).with(logic);
    }

    private async proceed_messages_queue(): Promise<Status> {
        const warnings: Status[] = [];
        for (const msg of this.messages_queue) {
            const status = await this.proceed_message(msg);
            if (!status.ok()) {
                warnings.push(status);
            }
        }
        this.messages_queue = [];
        return Status.ok_and_warnings("proceed messages", warnings);
    }

    private async proceed_message(msg: TelegramBot.Message): Promise<Status> {
        const is_start = msg.text?.toLocaleLowerCase() === "/start";

        if (!this.dialog || this.dialog.chat_id !== msg.chat.id || is_start) {
            this.dialog = undefined;
            const status = await Dialog.Start(this, msg.chat.id, this.journal);
            if (!status.ok()) {
                return status.wrap("can't start dialog");
            }
            this.dialog = status.value!;
        }

        return this.dialog.on_message(msg);
    }

    private async handle_deposit_tracker_event(event: DepositsTrackerEvent): Promise<Status> {
        if (!this.dialog) {
            return return_fail("no active dialog", this.journal.log());
        }
        return await this.deposit_activity.on_deposit_event(event, this.dialog)
    }
}
