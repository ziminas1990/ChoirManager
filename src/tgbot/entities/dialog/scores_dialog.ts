import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import assert from "assert";

import { BotAPI } from "../../api/telegram.js";
import { Status } from "../../../status.js";
import { Language, Scores } from "../../database.js";
import { Runtime } from "../../runtime.js";
import { Journal } from "../../journal.js";
import { Formatter, GlobalFormatter, return_exception, return_fail, split_to_columns } from "../../utils.js";
import { UserLogic } from "../../logic/user.js";
import { Dialog } from "../../logic/dialog.js";
import { ScoresActions } from "../../use_cases/scores_actions.js";

const SCORES_DIR = path.join(process.cwd(), 'files/scores');

export class ScoresDialog {
    private journal: Journal;
    private formatter: Formatter;

    constructor(private user: UserLogic, parent_journal: Journal, formatter?: Formatter) {
        this.journal = parent_journal.child("dialog.scores");
        this.formatter = formatter ?? GlobalFormatter.instance();
        this.formatter.do_nothing();
    }

    async send_scores(filename: string, dialog?: Dialog): Promise<Status> {
        this.journal.log().info(`sending scores ${filename}`);

        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        try {
            const filePath = path.join(SCORES_DIR, filename);
            await BotAPI.instance().sendDocument(
                dialog.chat_id,
                fs.createReadStream(filePath),
                undefined,
                {
                    contentType: "application/pdf",
                }
            );
            return Status.ok();
        } catch (err) {
            BotAPI.instance().sendMessage(
                dialog.chat_id, this.fail_to_send_file(dialog.user.data.lang));
            return return_exception(err, this.journal.log());
        }
    }

    async send_scores_list(dialog?: Dialog): Promise<Status> {
        this.journal.log().info("sending scores list");

        if (!dialog) {
            dialog = this.user.main_dialog();
            if (!dialog) {
                return return_fail(`no active dialog`, this.journal.log());
            }
        }

        const runtime = Runtime.get_instance();
        const database = runtime.get_database();

        const scores = [...database.all_scores()]
            .filter(score => score.file)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (scores.length == 0) {
            dialog.send_message(this.no_scores_available(this.user.data.lang));
            return Status.ok();
        }

        const callbacks = dialog.user.callbacks_registry();

        const create_button = (score: Scores): TelegramBot.InlineKeyboardButton => {
            assert(score.file, "score file is undefined");
            const callback_params = { file: score.file };
            const callback_id = callbacks.add_callback({
                fn: async (params: typeof callback_params) => {
                    return await ScoresActions.download_scores(
                        Runtime.get_instance(),
                        dialog.user.data.tgid,
                        params.file,
                        this.journal,
                        dialog);
                },
                journal: this.journal.child("callback"),
                params: callback_params,
                debug_name: `download ${score.name} scores`,
            });
            return {
                text: score.name,
                callback_data: callback_id
            };
        }

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: split_to_columns(scores, 2).map(scores => scores.map(create_button))
        };

        try {
            await BotAPI.instance().sendMessage(
                dialog.chat_id,
                this.get_scores_list(this.user.data.lang),
                {
                    reply_markup: keyboard,
                });
            return Status.ok();
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }

    private get_scores_list(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Какие ноты тебе нужны?";
            case Language.EN:
            default:
                return "Which scores do you need?";
        }
    }

    private no_scores_available(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Нет доступных файлов";
            case Language.EN:
            default:
                return "No available scores";
        }
    }

    private fail_to_send_file(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Сори, что-то пошло не так...";
            case Language.EN:
            default:
                return "Sorry, something went wrong...";
        }
    }
}
