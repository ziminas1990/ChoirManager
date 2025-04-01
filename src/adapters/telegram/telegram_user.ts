import TelegramBot from "node-telegram-bot-api";

import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Status } from "@src/status.js";
import { Journal } from "@src/journal.js";
import { DepositChange } from "@src/fetchers/deposits_fetcher.js";
import { Deposit } from "@src/fetchers/deposits_fetcher.js";
import { Role, Scores, User } from "@src/database.js";
import { GlobalFormatter, return_exception, return_fail } from "@src/utils.js";
import { CoreAPI } from "@src/use_cases/core.js";
import { IcomingItem } from "./adapter.js";
import { TelegramCallbacks } from "./callbacks.js";
import { ScoresDialog } from "./dialogs/scores_dialog.js";
import { DepositOwnerDialog } from "./dialogs/deposit_owner_dialog.js";
import { AccounterDialog } from "./dialogs/accounter_dialog.js";
import { ChoristerDialog } from "./dialogs/chorister_dialog.js";
import { GuestDialog } from "./dialogs/guest_dialog.js";


export class TelegramUser implements IUserAgent {
    private journal: Journal;
    private queue: IcomingItem[] = [];
    private bot?: TelegramBot;
    private callbacks_registry: TelegramCallbacks

    private scores_dialog?: ScoresDialog;
    private deposit_owner_dialog?: DepositOwnerDialog;
    private accounter_dialog?: AccounterDialog;
    private chorister_dialog?: ChoristerDialog;
    private guest_dialog?: GuestDialog;

    private timings: {
        next_user_info_update?: number;
    };

    public static pack(user: TelegramUser) {
        return {
            tgid: user.user_info.tgid,
            chat_id: user.chat_id,
        } as const;
    }

    public static unpack(
        user_info: User,
        packed: ReturnType<typeof TelegramUser.pack>,
        parent_journal: Journal): TelegramUser
    {
        return new TelegramUser(user_info, packed.chat_id, parent_journal);
    }

    constructor(private user_info: User, private chat_id: number, parent_journal: Journal) {
        this.journal = parent_journal.child(`@${this.user_info.tgid}`);
        this.callbacks_registry = new TelegramCallbacks(this.journal);
        this.timings = {};
    }

    init(bot: TelegramBot): Status {
        this.bot = bot;

        const status = CoreAPI.on_new_user_agent(this.user_info.tgid, this);
        if (!status.ok()) {
            return status.wrap(`Can't register user ${this.user_info.tgid} agent`);
        }

        return Status.ok();
    }

    info() { return this.user_info; }

    put_incoming_item(item: IcomingItem) {
        this.queue.push(item);
    }

    // From IBaseAgent
    userid(): string { return this.user_info.tgid; }

    get_scores_dialog(): ScoresDialog {
        if (!this.scores_dialog) {
            this.scores_dialog = new ScoresDialog(this, this.journal);
        }
        return this.scores_dialog;
    }

    get_deposit_owner_dialog(): DepositOwnerDialog {
        if (!this.deposit_owner_dialog) {
            this.deposit_owner_dialog = new DepositOwnerDialog(this, this.journal);
        }
        return this.deposit_owner_dialog;
    }

    get_accounter_dialog(): AccounterDialog {
        if (!this.accounter_dialog) {
            this.accounter_dialog = new AccounterDialog(this);
        }
        return this.accounter_dialog;
    }

    create_keyboard_button(
        text: string,
        debug_name: string,
        callback: () => Promise<Status>,
        lifetime_sec?: number)
    : TelegramBot.InlineKeyboardButton {
        const callback_id = this.callbacks_registry.add_callback({
            fn: async () => { return await callback(); },
            journal: this.journal.child(`callback.${debug_name}`),
            debug_name: debug_name,
        }, lifetime_sec);
        return {
            text: text,
            callback_data: callback_id
        };
    }

    // From IBaseAgent
    async send_message(message: string, options?: TelegramBot.SendMessageOptions): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            await this.bot.sendMessage(this.chat_id, message, {
                ...options,
                parse_mode: "HTML"
            });
            this.journal.log().info({ message }, "message sent")
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    // From IBaseAgent
    async send_file(filename: string, caption?: string, content_type?: string): Promise<Status> {
        if (!this.bot) {
            return return_fail("API is not initialized", this.journal.log());
        }
        try {
            const options: TelegramBot.SendDocumentOptions = {
                caption,
            };
            const file_options: TelegramBot.FileOptions = {
                contentType: content_type,
            };
            await this.bot.sendDocument(this.chat_id, filename, options, file_options);
            this.journal.log().info({ document: filename }, "document sent")
            return Status.ok();
        } catch (e) {
            return return_exception(e, this.journal.log());
        }
    }

    // From IScoresSubscriberAgent
    async send_scores_list(scores: Scores[]): Promise<Status> {
        return await this.get_scores_dialog().send_scores_list(scores);
    }

    // From IDepositOwnerAgent
    async send_deposit_info(deposit: Deposit | undefined): Promise<Status> {
        return await this.get_deposit_owner_dialog().send_deposit_info(deposit);
    }

    // From IDepositOwnerAgent
    async send_deposit_changes(deposit: Deposit, changes: DepositChange): Promise<Status> {
        return await this.get_deposit_owner_dialog().on_deposit_change(deposit, changes);
    }

    // From IDepositOwnerAgent
    async send_already_paid_response(): Promise<Status> {
        return await this.get_deposit_owner_dialog().send_already_paid_response();
    }

    // From IDepositOwnerAgent
    async send_membership_reminder(amount: number): Promise<Status> {
        return await this.get_deposit_owner_dialog().send_reminder(amount);
    }

    // From IDepositOwnerAgent
    async send_thanks_for_information(): Promise<Status> {
        return await this.get_deposit_owner_dialog().send_thanks_for_information();
    }

    // From IAccounterAgent
    async send_already_paid_notification(who: User): Promise<Status> {
        return await this.get_accounter_dialog().send_already_paid_notification(who);
    }

    // From IAccounterAgent
    async send_top_up_notification(who: User, amount: number, original_message: string): Promise<Status> {
        return await this.get_accounter_dialog().send_top_up_notification(who, amount, original_message);
    }

    // From IAccounterAgent
    async mirror_deposit_changes(who: User, deposit: Deposit, changes: DepositChange): Promise<Status> {
        return await this.get_accounter_dialog().mirror_deposit_changes(who, deposit, changes);
    }

    // From IAccounterAgent
    async mirror_reminder(who: User, amount: number): Promise<Status> {
        return await this.get_accounter_dialog().mirror_reminder(who, amount, this.user_info.lang);
    }

    // From IAdminAgent
    async send_notification(message: string): Promise<Status> {
        const formatter = GlobalFormatter.instance();
        return await this.send_message([
            formatter.bold("Admin's notification:"),
            "",
            message,
        ].join("\n"));
    }

    async proceed(now: Date): Promise<void> {
        this.maybe_update_user_info(now);
        this.callbacks_registry.proceed(now);

        if (this.queue.length == 0) {
            return;
        }
        const main_dialog = this.get_main_dialog();

        for (const item of this.queue) {
            if (item.what == "message") {
                if (main_dialog) {
                    const status = await main_dialog.on_message(item.message);
                    if (!status.ok()) {
                        this.journal.log().error(`Failed to handle message: ${status.what()}`);
                    }
                } else {
                    this.journal.log().warn("ignoring message: no main dialog");
                }
            } else if (item.what == "callback") {
                const status = await this.callbacks_registry.on_callback(item.callback);
                if (!status.ok()) {
                    this.journal.log().error(`Failed to handle callback: ${status.what()}`);
                }
            }
        }
        this.queue = [];
    }

    maybe_update_user_info(now: Date) {
        if (this.timings.next_user_info_update == undefined) {
            this.timings.next_user_info_update = now.getTime() + 10000;
            return;
        }
        if (this.timings.next_user_info_update > now.getTime()) {
            return;
        }

        const user_info = CoreAPI.get_user_by_tg_id(this.userid(), true);
        if (user_info.ok() && user_info.value != undefined) {
            this.user_info = user_info.value!;
        }
    }

    private get_main_dialog(): ChoristerDialog | GuestDialog | undefined {
        if (this.user_info.is(Role.Guest)) {
            if (!this.guest_dialog) {
                this.guest_dialog = new GuestDialog(this, this.journal);
            }
            return this.guest_dialog;
        } else if (this.user_info.is(Role.Chorister)) {
            if (!this.chorister_dialog) {
                this.chorister_dialog = new ChoristerDialog(this, this.journal);
            }
            return this.chorister_dialog;
        }
        return undefined;
    }
}
