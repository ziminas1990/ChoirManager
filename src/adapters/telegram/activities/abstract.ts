import TelegramBot from "node-telegram-bot-api";
import { Status } from "@src/status.js";

export interface AbstractActivity {

    start(): Promise<Status>;

    interrupt(): Promise<Status>;

    waits_for_message(): boolean;

    consume_message(message: TelegramBot.Message): Promise<Status>;

    // Return true if activity has finished
    finished(): boolean
}