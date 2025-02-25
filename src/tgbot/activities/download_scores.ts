import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../api/telegram.js";
import fs from "fs";
import path from "path";
import { StatusWith, Status } from "../../status.js";
import { Language } from "../database.js";

const SCORES_DIR = path.join(process.cwd(), 'files/scores');

function get_scores_list(): StatusWith<string[]> {
    try {
        const files = fs.readdirSync(SCORES_DIR);
        return StatusWith.ok().with(files.filter(file => file.endsWith(".pdf")));
    } catch (error) {
        return StatusWith.fail(`Failed to read scores directory: ${error}`);
    }
}

function split_to_columns(list: string[], columns: number): string[][] {
    const result: string[][] = [];
    for (let i = 0; i < list.length; i += columns) {
        result.push(list.slice(i, i + columns));
    }
    return result;
}

export class DownloadScoresActivity extends BaseActivity {
    private messages: Messages;

    constructor(dialog: Dialog)
    {
        super(dialog);
        this.messages = new Messages(dialog.user.user.lang);
    }

    start(): void {
        this.send_scores_list();
    }

    on_message(_: TelegramBot.Message): Status {
        return Status.ok();
    }

    on_callback(query: TelegramBot.CallbackQuery): Status {
        const file_name = query.data?.replace("get_", "") + ".pdf";
        if (file_name == undefined) {
            return Status.fail(`unexpected callback: ${query.data}`);
        }

        const filePath = path.join(SCORES_DIR, file_name);

        BotAPI.instance().sendDocument(
            this.dialog.chat_id,
            fs.createReadStream(filePath),
            undefined,
            {
                contentType: "application/pdf",
            }
        ).catch((err: Error) => {
            BotAPI.instance().sendMessage(
                this.dialog.chat_id, this.messages.fail_to_send_file());
            return Status.fail(`failed to send file: ${err.message}`);
        });
        return Status.ok();
    }

    private send_scores_list(): void {
        const files = get_scores_list();

        if (!files.done() || files.value == undefined) {
            this.send_fail_to_get_scores();
            this.set_done();
            return;
        }

        if (files.value!.length == 0) {
            BotAPI.instance().sendMessage(
                this.dialog.chat_id, this.messages.no_scores_available());
            this.set_done();
            return;
        }

        files.value = files.value.map(file => file.replace(".pdf", "")).sort();

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: []
        };

        split_to_columns(files.value, 2).forEach((files) => {
            keyboard.inline_keyboard.push(files.map(file => ({
                text: file,
                callback_data: `get_${file}`
            })));
        });

        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            this.messages.get_scores_list(),
            {
                reply_markup: keyboard,
            });
    }

    private send_fail_to_get_scores(): void {
        BotAPI.instance().sendMessage(
            this.dialog.chat_id,
            this.messages.fail_to_get_scores());
    }

}

class Messages {
    constructor(private lang: Language)
    {}

    get_scores_list(): string {
        switch (this.lang) {
            case "ru": return "Какие ноты тебе нужны?";
            case "en":
            default:
                return "Which scores do you need?";
        }
    }

    fail_to_get_scores(): string {
        switch (this.lang) {
            case "ru": return "Почему-то не могу получить список доступных нот";
            case "en":
            default:
                return "Can't get the list of available scores for some reason";
        }
    }

    no_scores_available(): string {
        switch (this.lang) {
            case "ru": return "Нет доступных файлов";
            case "en":
            default:
                return "No available scores";
        }
    }

    fail_to_send_file(): string {
        switch (this.lang) {
            case "ru": return "Сори, что-то пошло не так...";
            case "en":
            default:
                return "Sorry, something went wrong...";
        }
    }
}