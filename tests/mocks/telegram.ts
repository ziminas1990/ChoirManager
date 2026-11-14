import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestContext, mock } from "node:test";

import * as TelegramBot from "node-telegram-bot-api";

import { unexpected } from "./unexpected.js";

export function telegram_message(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
    return { message_id: 1, date: 1, chat: { id: 123, type: "private" }, ...overrides };
}

export function telegram_callback(overrides: Partial<TelegramBot.CallbackQuery> = {}): TelegramBot.CallbackQuery {
    return { id: "query", chat_instance: "test-chat",
        from: { id: 456, first_name: "Member", is_bot: false }, ...overrides };
}

type TelegramOverrides = {
    sendMessage?: (params: TelegramBot.SendMessageParams) => Promise<Pick<TelegramBot.Message, "message_id">>;
    sendRichMessage?: (params: TelegramBot.SendRichMessageParams) => Promise<Pick<TelegramBot.Message, "message_id">>;
    answerCallbackQuery?: (params: TelegramBot.AnswerCallbackQueryParams) => Promise<void>;
    editMessageText?: TelegramBot.Api["editMessageText"];
    editMessageReplyMarkup?: TelegramBot.Api["editMessageReplyMarkup"];
    deleteMessage?: TelegramBot.Api["deleteMessage"];
};

// Keep the SDK object and update dispatch, replacing only network operations.
export function mock_telegram(overrides: TelegramOverrides): TelegramBot.Bot {
    const bot = new TelegramBot.Bot("test-only-token");
    bot.api.sendMessage = async params => telegram_message(await (overrides.sendMessage ?? unexpected)(params));
    bot.api.sendRichMessage = async params => telegram_message(await (overrides.sendRichMessage ?? unexpected)(params));
    bot.api.answerCallbackQuery = async params => {
        await (overrides.answerCallbackQuery ?? unexpected)(params);
        return true;
    };
    bot.api.editMessageText = overrides.editMessageText ?? unexpected;
    bot.api.editMessageReplyMarkup = overrides.editMessageReplyMarkup ?? unexpected;
    bot.api.deleteMessage = overrides.deleteMessage ?? unexpected;
    bot.api.sendDocument = unexpected;
    bot.api.sendChatAction = unexpected;
    return bot;
}

export function telegram_token(t: TestContext) {
    let client: TelegramBot.Bot | undefined;
    const directory = mkdtempSync(join(tmpdir(), "choir-telegram-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, "token");
    writeFileSync(filename, "test-only-token");
    mock.method(TelegramBot.Api.prototype, "getMe", async () => ({ id: 999, is_bot: true, first_name: "Test", username: "test_bot" }));
    mock.method(TelegramBot.Bot.prototype, "startPolling", async function(this: TelegramBot.Bot) {
        client = this;
    });
    return { filename, client() {
        if (!client) {
            throw new Error("Telegram adapter has not initialized its client");
        }
        return client;
    } };
}

export function inline_keyboard(options?: Omit<TelegramBot.SendMessageParams, "chat_id" | "text">)
: TelegramBot.InlineKeyboardButton[][] {
    const markup = options?.reply_markup;
    if (!markup || !markup.inline_keyboard) {
        throw new Error("Expected inline keyboard");
    }
    return markup.inline_keyboard;
}

export async function emit_telegram(
    client: TelegramBot.Bot,
    event: "message" | "edited_message", message:
    TelegramBot.Message)
: Promise<void> {
    const update: TelegramBot.Update = event === "message"
        ? { update_id: message.message_id, message }
        : { update_id: message.message_id, edited_message: message };
    await client.handleUpdate(update);
}

export type TelegramDelivery = {
    chat_id: TelegramBot.SendMessageParams["chat_id"];
    text: string;
    options?: Omit<TelegramBot.SendMessageParams, "chat_id" | "text">;
    message_id: number;
};
