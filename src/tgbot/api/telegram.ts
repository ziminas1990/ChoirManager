import TelegramBot from "node-telegram-bot-api";

export class BotAPI {
    private static _instance: TelegramBot;

    public static instance(): TelegramBot {
        if (this._instance == undefined) {
            throw new Error("BotAPI is not initialized");
        }
        return this._instance;
    }

    public static init(token: string): void {
        this._instance = new TelegramBot(token, { polling: true });
    }
}
