import { TelegramSettings } from "@src/entities/telegram_settings.js";
import { Expected, Status } from "@src/utils/expected.js";

// Stores one complete Telegram settings document.
export interface ITelegramSettingsStorage {
    get(): Promise<Expected<TelegramSettings | undefined>>;
    update(settings: TelegramSettings): Promise<Status>;
    delete(): Promise<Status>;
}
