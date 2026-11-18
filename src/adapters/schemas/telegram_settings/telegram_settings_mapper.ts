import assert from "assert";

import { TelegramSettings } from "@src/entities/telegram_settings.js";
import { TelegramSettingsRecord } from "./telegram_settings_record.js";

export function to_record(settings: TelegramSettings): Extract<TelegramSettingsRecord, { schema: 1 }> {
    return {
        schema: 1,
        choir_chat_id: settings.choir_chat_id,
        announce_thread_id: settings.announce_thread_id,
        managers_chat_id: settings.managers_chat_id,
    };
}

export function to_entity(record: TelegramSettingsRecord): TelegramSettings {
    const latest = to_latest_version(record);
    return {
        choir_chat_id: latest.choir_chat_id,
        announce_thread_id: latest.announce_thread_id,
        managers_chat_id: latest.managers_chat_id,
    };
}

export function to_latest_version(
    record: TelegramSettingsRecord,
): Extract<TelegramSettingsRecord, { schema: 1 }> {
    assert(record.schema === 1, `Unsupported Telegram settings schema: ${record.schema}`);
    return record;
}
