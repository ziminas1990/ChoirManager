import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../items/dialog.js";
import { BaseActivity } from "./base_activity.js";
import { BotAPI } from "../globals.js";
import fs from "fs";
import path from "path";
import { StatusWith } from "../../status.js";

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
    constructor(dialog: Dialog)
    {
        super(dialog);
    }

    start(): void {
        this.send_scores_list();
    }

    on_message(_: TelegramBot.Message): void {}

    on_callback(query: TelegramBot.CallbackQuery): void {
        const file_name = query.data?.replace("get_", "") + ".pdf";
        if (file_name == undefined) {
            return;
        }

        const filePath = path.join(SCORES_DIR, file_name);

        BotAPI.instance().sendDocument(
            this.dialog.chat_id,
            fs.createReadStream(filePath),
            undefined,
            {
                contentType: "application/pdf",
            }
        ).catch((err) => {
            console.error("Ошибка отправки файла:", err);
            BotAPI.instance().sendMessage(this.dialog.chat_id, "Сори, что-то пошло не так...");
        });
    }

    private send_scores_list(): void {
        const files = get_scores_list();

        if (!files.is_ok() || files.value == undefined) {
            this.send_fail_to_get_scores();
            this.set_done();
            return;
        }

        if (files.value!.length == 0) {
            BotAPI.instance().sendMessage(this.dialog.chat_id, "Нет доступных файлов.");
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

        BotAPI.instance().sendMessage(this.dialog.chat_id, "Какие ноты тебе нужны?", {
            reply_markup: keyboard,
        });
    }

    private send_fail_to_get_scores(): void {
        BotAPI.instance().sendMessage(
            this.dialog.chat_id, "Почему-то не могу получить список доступных нот");
    }

}
