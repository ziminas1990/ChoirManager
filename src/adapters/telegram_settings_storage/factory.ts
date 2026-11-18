import { KeyValueStorageConfig, KeyValueStorageFactory } from "@src/adapters/key_value_storage/factory.js";
import { ITelegramSettingsStorage } from "@src/interfaces/storage/telegram_settings_storage.js";
import { Expected, Status } from "@src/utils/expected.js";
import { KeyValueTelegramSettingsStorage } from "./key_value.js";

export type TelegramSettingsStorageConfig = {
    document: string;
    storage: KeyValueStorageConfig;
};

export class TelegramSettingsStorageFactory {
    static create(config: TelegramSettingsStorageConfig): Expected<ITelegramSettingsStorage> {
        const verified = this.verify(config);
        if (!verified.ok) {
            return verified.cast_error();
        }
        const storage = KeyValueStorageFactory.create(config.storage);
        if (!storage.ok) {
            return storage.cast_error();
        }
        return Expected.ok(new KeyValueTelegramSettingsStorage(config.document, storage.value));
    }

    static verify(config: TelegramSettingsStorageConfig): Status {
        if (!config || typeof config.document !== "string" || !config.document.trim()) {
            return Expected.err("'document' MUST be specified");
        }
        if (!config.storage) {
            return Expected.err("'storage' MUST be specified");
        }
        const verified = KeyValueStorageFactory.verify(config.storage);
        if (!verified.ok) {
            return verified.wrap_error("'storage' misconfiguration");
        }
        return Expected.ok(undefined);
    }
}
