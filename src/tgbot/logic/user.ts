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


export class UserLogic extends Logic<void> {
    private dialog?: Dialog;
    private messages_queue: TelegramBot.Message[] = [];
    private last_activity?: Date;
    private deposit_tracker?: DepositsTracker;
    private deposit_activity: DepositActivity;

    constructor(public readonly data: User, proceed_interval_ms: number) {
        super(proceed_interval_ms);
        this.last_activity = new Date();
        this.deposit_activity = new DepositActivity(this);

        if (this.is_accountant()) {
            DepositActivity.add_accountant(this);
        }
    }

    attach_deposit_fetcher(fetcher: DepositsFetcher): void {
        this.deposit_tracker = new DepositsTracker(this.data.tgid, fetcher);
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

    main_dialog(): Dialog | undefined {
        return this.dialog;
    }

    on_message(msg: TelegramBot.Message): Status {
        this.last_activity = new Date();
        if (msg.chat.type !== "private") {
            return Status.fail("Message is not from a private chat");
        }
        this.messages_queue.push(msg);
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        this.last_activity = new Date();
        const chat_id = query.message?.chat.id;
        if (!chat_id) {
            return Status.fail("chat_id is undefined");
        }
        if (!this.dialog) {
            return Status.fail("dialog is undefined");
        }
        return this.dialog.on_callback(query);
    }

    get_last_activity() {
        return this.last_activity;
    }

    async send_deposit_info(): Promise<Status> {
        if (!this.dialog) {
            return Status.fail("no active dialog");
        }

        const deposit_info = this.deposit_tracker?.get_deposit()
        if (deposit_info) {
            return await this.deposit_activity.send_deposit_info(deposit_info, this.dialog);
        } else {
            this.dialog?.send_message("Error: no deposit info available")
            return Status.fail("no deposit info available");
        }
    }

    async proceed_impl(now: Date): Promise<Status> {
        const status = await this.proceed_messages_queue();
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

        if (this.deposit_tracker) {
            const events = await this.deposit_tracker.proceed(now);
            if (!events.ok()) {
                warnings.push(events.wrap("deposit_tracker"));
            }
            for (const event of events.value ?? []) {
                await this.handle_deposit_tracker_event(event);
            }
        }

        return Status.ok_and_warnings("dialog proceed", warnings);
    }

    async send_runtime_backup(): Promise<Status> {
        if (!this.dialog) {
            return Status.fail("no active dialog");
        }
        if (!this.is_admin()) {
            return Status.fail("not an admin");
        }

        BotAPI.instance().sendDocument(
            this.dialog.chat_id,
            fs.createReadStream(Config.data.runtime_cache_filename),
            undefined,
            {
                contentType: "application/json",
            }
        );
        return Status.ok();
    }

    static pack(user: UserLogic) {
        return {
            "tgid": user.data.tgid,
            "dlg": user.dialog ? Dialog.pack(user.dialog) : undefined
        } as const;
    }

    static unpack(database: Database, packed: ReturnType<typeof UserLogic.pack>)
    : StatusWith<UserLogic> {
        const [tgid, dialog] = [packed.tgid, packed.dlg];

        const user = tgid ? database.get_user_by_tg_id(tgid) : database.get_guest_user();
        if (!user) {
            return StatusWith.fail(`User @${tgid} not found`);
        }
        const logic = new UserLogic(user, 100);

        // Load dialogs
        const unpack_dialog_status: StatusWith<Dialog> =
            dialog ? Dialog.unpack(logic, dialog) : Status.ok();
        if (unpack_dialog_status.ok()) {
            logic.dialog = unpack_dialog_status.value!;
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
            const status = await Dialog.Start(this, msg.chat.id);
            if (!status.ok()) {
                return status.wrap("can't start dialog");
            }
            this.dialog = status.value!;
        }

        return this.dialog.on_message(msg);
    }

    private async handle_deposit_tracker_event(event: DepositsTrackerEvent): Promise<Status> {
        if (!this.dialog) {
            return Status.fail("no active dialog");
        }
        return await this.deposit_activity.on_deposit_event(event, this.dialog)
    }
}
