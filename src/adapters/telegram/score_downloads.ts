import type TelegramBot from "node-telegram-bot-api";

import type { TelegramUser } from "./telegram_user.js";
import { Score } from "@src/entities/score.js";
import { Language } from "@src/entities/user.js";
import { IJournal } from "@src/interfaces/journal.js";
import { ScoresActions, ScoresError } from "@src/use_cases/scores_actions.js";
import { Expected, Status } from "@src/utils/expected.js";

export class ScoreDownloads {
    private static readonly prefix = "score:v1:";

    static create_button(score: Score): TelegramBot.InlineKeyboardButton {
        return {
            text: score.name,
            callback_data: this.prefix + score.get_id(),
        };
    }

    static matches(data: string | undefined): boolean {
        return data?.startsWith(this.prefix) ?? false;
    }

    static async on_callback(data: string, user: TelegramUser, journal: IJournal): Promise<Status> {
        let status: Status;
        try {
            status = await ScoresActions.download_scores_request(
                user, { id: data.slice(this.prefix.length) }, journal);
        } catch (error) {
            status = Expected.exception("score download failed", error);
        }

        if (status.ok) {
            return status;
        }

        const feedback = await user.send_message(this.failure_message(status, user.info().lang));
        return feedback.ok ? status : feedback.as_status();
    }

    private static failure_message(status: Status, lang: Language): string {
        if (status.is_error(ScoresError.AccessDenied)) {
            return lang === Language.RU
                ? "У тебя нет доступа к скачиванию нот. Обратись к руководителю хора, чтобы уточнить права доступа."
                : "You do not have permission to download scores. Contact the choir manager to check your access.";
        }
        if (status.is_error(ScoresError.NotFound)) {
            return lang === Language.RU
                ? "Эти ноты больше недоступны. Открой новый список через «Скачать ноты»; если нужных нот нет, обратись к руководителю хора."
                : "These scores are no longer available. Open a new list using Download scores; if the scores are missing, contact the choir manager.";
        }
        return lang === Language.RU
            ? "Не удалось получить ноты. Попробуй нажать кнопку ещё раз позже. Если проблема повторится, обратись к руководителю хора."
            : "Could not retrieve the scores. Try clicking the button again later. If the problem persists, contact the choir manager.";
    }
}
