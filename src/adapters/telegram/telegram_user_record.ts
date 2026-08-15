import { VersionedPlainItem } from "@src/interfaces/plain_collection.js";

// Telegram identity mapping owned by the telegram adapter.
// Not UserData: user_id is UserData.id.system_id from UserService.
// PlainItem.id is the telegram user id as a string.
export type TelegramUserRecord = VersionedPlainItem & {
    user_id: string;
    telegram_username: string;
    private_chat_id: number;
}

export function telegram_user_record_id(telegram_id: number): string {
    return String(telegram_id);
}

export function telegram_id_from_record(record: TelegramUserRecord): number {
    return Number(record.id);
}
