import { ITelegramSettingsStorage } from "@src/interfaces/storage/telegram_settings_storage.js";

import { unexpected } from "./unexpected.js";

export function mock_telegram_settings_storage(
    overrides: Partial<ITelegramSettingsStorage> = {},
): ITelegramSettingsStorage {
    return {
        get: unexpected, update: unexpected, delete: unexpected,
        ...overrides,
    };
}
