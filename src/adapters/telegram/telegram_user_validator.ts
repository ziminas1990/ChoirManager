import { Expected, Status } from "@src/utils/expected.js";
import { TelegramUserRecord } from "./telegram_user_record.js";

export function validate_telegram_user_record(item: TelegramUserRecord): Status {
    if (!item.id) {
        return Expected.err("id is required");
    }
    if (!Number.isFinite(Number(item.id))) {
        return Expected.err("id must be a telegram user id");
    }
    if (typeof item.revision !== "number") {
        return Expected.err("revision is required");
    }
    if (!item.user_id) {
        return Expected.err("user_id is required");
    }
    if (!item.telegram_username) {
        return Expected.err("telegram_username is required");
    }
    if (typeof item.private_chat_id !== "number") {
        return Expected.err("private_chat_id is required");
    }
    return Expected.ok(undefined);
}
