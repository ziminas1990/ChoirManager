import { VersionedPlainItem } from "@src/interfaces/plain_collection.js";

// Telegram identity mapping owned by the telegram adapter.
// Not UserData: user_id is UserData.id.system_id from UserService.
export type TelegramUserRecord = VersionedPlainItem & {
    user_id: string;
    telegram_username: string;
    telegram_id: number;
    private_chat_id: number;
}

export function telegram_user_record_id(telegram_id: number): string {
    return String(telegram_id);
}
