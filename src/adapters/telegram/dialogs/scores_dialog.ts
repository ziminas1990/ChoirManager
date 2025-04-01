import TelegramBot from "node-telegram-bot-api";

import { Status } from "@src/status.js";
import { Language, Scores } from "@src/database.js";
import { Journal } from "@src/journal.js";
import { return_exception, split_to_columns } from "@src/utils.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";

export class ScoresDialog {
    private journal: Journal;

    constructor(
        private user: TelegramUser,
        parent_journal: Journal)
    {
        this.journal = parent_journal.child("dialog.scores");
    }

    async send_scores_list(scores: Scores[]): Promise<Status> {
        this.journal.log().info("sending scores list");

        if (scores.length == 0) {
            this.user.send_message(this.no_scores_available(this.user.info().lang));
            return Status.ok();
        }

        // send only scores with files
        scores = scores.filter(score => score.file);

        const buttons = scores.map(score => {
            return this.user.create_keyboard_button(
                score.name,
                `download ${score.name} scores`,
                () => this.do_download_scores(score),
                3600
            );
        });

        const keyboard: TelegramBot.InlineKeyboardMarkup = {
            inline_keyboard: split_to_columns(buttons, 2)
        };

        try {
            return this.user.send_message(
                this.get_scores_list(this.user.info().lang),
                {
                    reply_markup: keyboard,
                });
        } catch (err) {
            return return_exception(err, this.journal.log());
        }
    }

    private async do_download_scores(score: Scores): Promise<Status> {
        this.journal.log().info(`downloading scores ${score.name}`);
        const status = await ScoresActions.download_scores_request(this.user, score, this.journal);
        if (!status.ok()) {
            return this.user.send_message(this.fail_to_send_file(this.user.info().lang));
        }
        return status;
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
