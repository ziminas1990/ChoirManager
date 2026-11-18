import { to_entity, to_record } from "@src/adapters/schemas/telegram_settings/telegram_settings_mapper.js";
import { telegram_settings_record_schema } from "@src/adapters/schemas/telegram_settings/telegram_settings_validator.js";
import { TelegramSettings } from "@src/entities/telegram_settings.js";
import { IKeyValueStorage } from "@src/interfaces/storage/key_value_storage.js";
import { ITelegramSettingsStorage } from "@src/interfaces/storage/telegram_settings_storage.js";
import { Expected, Status } from "@src/utils/expected.js";

export class KeyValueTelegramSettingsStorage implements ITelegramSettingsStorage {
    constructor(
        private readonly key: string,
        private readonly storage: IKeyValueStorage,
    ) {}

    async get(): Promise<Expected<TelegramSettings | undefined>> {
        const document = await this.storage.get(this.key);
        if (!document.ok) {
            return document.cast_error();
        }
        if (document.value === undefined) {
            return Expected.ok(undefined);
        }
        try {
            const record = telegram_settings_record_schema.parse(JSON.parse(document.value));
            return Expected.ok(to_entity(record));
        } catch (error) {
            return Expected.exception("Failed to decode Telegram settings", error);
        }
    }

    async update(settings: TelegramSettings): Promise<Status> {
        return this.storage.update(this.key, JSON.stringify(to_record(settings)));
    }

    async delete(): Promise<Status> {
        return this.storage.delete(this.key);
    }
}
