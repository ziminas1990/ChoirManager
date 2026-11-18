export type TelegramSettingsRecord =
    { schema: 1 } & TelegramSettingsRecord_v1;

type TelegramSettingsRecord_v1 = {
    choir_chat_id?: number;
    announce_thread_id?: number;
    managers_chat_id?: number;
};
