import { z } from "zod";

const chat_id = z.number().int().safe().refine(value => value !== 0, "Chat ID must not be zero");
const thread_id = z.number().int().safe().positive();

export const telegram_settings_record_schema = z.object({
    choir_chat_id: chat_id.optional(),
    announce_thread_id: thread_id.optional(),
    managers_chat_id: chat_id.optional(),
    schema: z.literal(1),
});
