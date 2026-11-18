import { readFile } from "node:fs/promises";
import { z } from "zod";

import { telegram_settings_schema } from "@src/adapters/schemas/telegram_settings/telegram_settings_validator.js";
import { TelegramSettings } from "@src/entities/telegram_settings.js";
import { Expected } from "@src/utils/expected.js";

const snapshot_schema = z.union([
    z.object({
        version: z.literal(2),
        cfg: z.object({
            chat_id: telegram_settings_schema.shape.choir_chat_id,
            announces_chat_id: telegram_settings_schema.shape.announce_thread_id,
            manager_chat_id: telegram_settings_schema.shape.managers_chat_id,
        }).optional(),
    }),
    z.object({
        version: z.union([z.literal(3), z.literal(4)]),
        tg_adapter: telegram_settings_schema.optional(),
    }),
]);

// Read-only migration source; runtime and Telegram are never instantiated.
export class RuntimeSnapshotTelegramSettingsSource {
    constructor(private readonly filename: string) {}

    async get(): Promise<Expected<TelegramSettings | undefined>> {
        try {
            const snapshot = snapshot_schema.parse(JSON.parse(await readFile(this.filename, "utf8")));
            if (snapshot.version === 2) {
                if (!snapshot.cfg) {
                    return Expected.ok(undefined);
                }
                return Expected.ok({
                    choir_chat_id: snapshot.cfg.chat_id,
                    announce_thread_id: snapshot.cfg.announces_chat_id,
                    managers_chat_id: snapshot.cfg.manager_chat_id,
                });
            }
            return Expected.ok(snapshot.tg_adapter);
        } catch (error) {
            return Expected.exception("Failed to read Telegram settings from runtime snapshot", error);
        }
    }
}
