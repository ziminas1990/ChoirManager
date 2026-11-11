import type { TgAdapterConfig } from "@src/config.js";
import { PlainCollectionFactory } from "@src/adapters/plain_collection/factory.js";
import { IJournal } from "@src/interfaces/journal.js";
import { Expected } from "@src/utils/expected.js";
import { PackedTgAdapter, TgAdapter, TgAdapterCfg, TgAdapterEnv } from "./adapter.js";
import { telegram_user_firestore_converter } from "./telegram_user_mapper.js";

export class TgAdapterFactory {
    static create(
        config: TgAdapterConfig,
        adapter_cfg: TgAdapterCfg,
        env: TgAdapterEnv,
        parent_journal: IJournal,
        packed?: PackedTgAdapter,
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

            const adapter_config = {
                token_file: config.token_file,
                formatting: config.formatting,
            };
            const adapter = packed
                ? TgAdapter.unpack(
                    adapter_config, adapter_cfg, env, collection.value, packed, parent_journal)
                : new TgAdapter(
                    adapter_config, adapter_cfg, env, collection.value, parent_journal);
            return Expected.ok(adapter);
        } catch (error) {
            return Expected.exception("Failed to create Telegram adapter", error);
        }
    }
}
