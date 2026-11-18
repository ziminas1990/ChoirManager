import type { TgAdapterConfig } from "@src/config.js";
import { PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { TelegramSettingsStorageFactory } from "@src/adapters/telegram_settings_storage/factory.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Expected } from "@src/utils/expected.js";
import { TgAdapter, TgAdapterCfg, TgAdapterEnv } from "./adapter.js";
import { telegram_user_firestore_converter } from "./telegram_user_mapper.js";

export class TgAdapterFactory {
    static create(
        config: TgAdapterConfig,
        adapter_cfg: TgAdapterCfg,
        env: TgAdapterEnv,
        parent_journal: IJournal,
    ): Expected<TgAdapter> {
        try {
            const collection = PlainCollectionFactory.create(
                config.users_storage,
                telegram_user_firestore_converter(),
                parent_journal.child("adapter.telegram"),
            );
            if (!collection.ok) {
                return collection.wrap_error("Failed to create Telegram users collection");
            }

            const settings_storage = TelegramSettingsStorageFactory.create(config.settings_storage);
            if (!settings_storage.ok) {
                return settings_storage.wrap_error("Failed to create Telegram settings storage");
            }

            const adapter_config = {
                token_file: config.token_file,
                formatting: config.formatting,
            };
            const adapter = new TgAdapter(
                adapter_config, adapter_cfg, env, collection.value,
                settings_storage.value, parent_journal);
            return Expected.ok(adapter);
        } catch (error) {
            return Expected.exception("Failed to create Telegram adapter", error);
        }
    }
}
