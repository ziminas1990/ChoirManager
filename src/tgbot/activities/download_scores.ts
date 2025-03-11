import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import fs from "fs";
import path from "path";
import { Status } from "../../status.js";
import { Language } from "../database.js";
import { Runtime } from "../runtime.js";

const SCORES_DIR = path.join(process.cwd(), 'files/scores');

function split_to_columns<T>(list: T[], columns: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < list.length; i += columns) {
        result.push(list.slice(i, i + columns));
    }
    return result;
}

export class DownloadScoresActivity extends BaseActivity {

    constructor(private dialog: Dialog)
    {
        super();
    }

    async start(): Promise<Status> {
        this.send_scores_list();
        return Status.ok();
    }

    async proceed(_: Date): Promise<Status> {
        return Status.ok();
    }

    async on_message(_: TelegramBot.Message): Promise<Status> {
        return Status.ok();
    }

    async on_callback(query: TelegramBot.CallbackQuery): Promise<Status> {
        const file_name = query.data?.replace("get_", "");
        if (file_name == undefined) {
            return Status.fail(`unexpected callback: ${query.data}`);
        }

        const filePath = path.join(SCORES_DIR, file_name);

        await BotAPI.instance().sendDocument(
            this.dialog.chat_id,
            fs.createReadStream(filePath),
            undefined,
            {
                contentType: "application/pdf",
            }
        ).catch((err: Error) => {
            BotAPI.instance().sendMessage(
                this.dialog.chat_id, Messages.fail_to_send_file(this.dialog.user.data.lang));
            return Status.fail(`failed to send file: ${err.message}`);
        });
        return Status.ok();
    }

    private async send_scores_list(): Promise<Status> {
        const runtime = Runtime.get_instance();
        const database = runtime.get_database();

        const scores = [...database.all_scores()]
            .filter(score => score.file)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (scores.length == 0) {
            BotAPI.instance().sendMessage(
                this.dialog.chat_id, Messages.no_scores_available(this.dialog.user.data.lang));
            this.set_done();
            return Status.ok();
        }

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: []
        };

        split_to_columns(scores, 2).forEach((scores) => {
            keyboard.inline_keyboard.push(scores.map(score => ({
                text: score.name,
                callback_data: `get_${score.file}`
            })));
        });

        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            Messages.get_scores_list(this.dialog.user.data.lang),
            {
                reply_markup: keyboard,
            });
        return Status.ok();
    }
}

class Messages {

    static get_scores_list(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Какие ноты тебе нужны?";
            case Language.EN:
            default:
                return "Which scores do you need?";
        }
    }

    static fail_to_get_scores(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Почему-то не могу получить список доступных нот";
            case Language.EN:
            default:
                return "Can't get the list of available scores for some reason";
        }
    }

    static no_scores_available(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Нет доступных файлов";
            case Language.EN:
            default:
                return "No available scores";
        }
    }

    static fail_to_send_file(lang: Language): string {
        switch (lang) {
            case Language.RU: return "Сори, что-то пошло не так...";
            case Language.EN:
            default:
                return "Sorry, something went wrong...";
        }
    }
}