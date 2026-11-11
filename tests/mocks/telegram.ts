import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestContext, mock } from "node:test";

import TelegramBot from "node-telegram-bot-api";

import { unexpected } from "./unexpected.js";

export function telegram_message(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
    return { message_id: 1, date: 1, chat: { id: 123, type: "private" }, ...overrides };
}

export function telegram_callback(overrides: Partial<TelegramBot.CallbackQuery> = {}): TelegramBot.CallbackQuery {
    return { id: "query", chat_instance: "test-chat",
        from: { id: 456, first_name: "Member", is_bot: false }, ...overrides };
}

type TelegramOverrides = {
    sendMessage?: (...args: Parameters<TelegramBot["sendMessage"]>) => Promise<Pick<TelegramBot.Message, "message_id">>;
    answerCallbackQuery?: (id: string, options?: TelegramBot.AnswerCallbackQueryOptions) => Promise<void>;
    editMessageText?: TelegramBot["editMessageText"];
    editMessageReplyMarkup?: TelegramBot["editMessageReplyMarkup"];
    deleteMessage?: TelegramBot["deleteMessage"];
};

// Keep the SDK object and its event API, replacing only network operations.
export function mock_telegram(overrides: TelegramOverrides): TelegramBot {
    const bot = new TelegramBot("test-only-token", { polling: false });
    bot.sendMessage = async (...args) => telegram_message(await (overrides.sendMessage ?? unexpected)(...args));
    bot.answerCallbackQuery = async (idOrOptions?: string | TelegramBot.AnswerCallbackQueryOptions, options?: TelegramBot.AnswerCallbackQueryOptions) => {
        if (typeof idOrOptions !== "string") unexpected();
        await (overrides.answerCallbackQuery ?? unexpected)(idOrOptions, options);
        return true;
    };
    bot.editMessageText = overrides.editMessageText ?? unexpected;
    bot.editMessageReplyMarkup = overrides.editMessageReplyMarkup ?? unexpected;
    bot.deleteMessage = overrides.deleteMessage ?? unexpected;
    bot.sendDocument = unexpected;
    bot.sendChatAction = unexpected;
    return bot;
}

export function telegram_token(t: TestContext) {
    let client: TelegramBot | undefined;
    const directory = mkdtempSync(join(tmpdir(), "choir-telegram-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, "token");
    writeFileSync(filename, "test-only-token");
    mock.method(TelegramBot.prototype, "startPolling", async function(this: TelegramBot) {
        client = this;
    });
    return { filename, client() {
        if (!client) throw new Error("Telegram adapter has not initialized its client");
        return client;
    } };
}

export function inline_keyboard(options?: TelegramBot.SendMessageOptions): TelegramBot.InlineKeyboardButton[][] {
    const markup = options?.reply_markup;
    if (!markup || !("inline_keyboard" in markup)) throw new Error("Expected inline keyboard");
    return markup.inline_keyboard;
}

export function emit_telegram(client: TelegramBot, event: "message" | "edited_message", message: TelegramBot.Message): boolean {
    // The SDK declaration types emit's arguments as listeners. Validate
    // its result while supplying the actual runtime event payload.
    const emitted: unknown = Reflect.apply(client.emit, client, [event, message]);
    if (typeof emitted !== "boolean") throw new Error("Unexpected event emission result");
    return emitted;
}

export type TelegramDelivery = {
    chat_id: TelegramBot.ChatId;
    text: string;
    options?: TelegramBot.SendMessageOptions;
    message_id: number;
};
