import TelegramBot from "node-telegram-bot-api";
import { Status } from "../../status";

export class BaseActivity {

    private is_done: boolean = false;

    constructor()
    {}

    async proceed(_: Date): Promise<Status> {
        throw new Error("Not implemented");
    }

    async start(): Promise<Status> {
        throw new Error("Not implemented");
    }

    async on_message(_: TelegramBot.Message): Promise<Status> {
        throw new Error("Not implemented");
    }

    async on_callback(_: TelegramBot.CallbackQuery): Promise<Status> {
        throw new Error("Not implemented");
    }

    done(): boolean {
        return this.is_done;
    }

    protected set_done(): void {
        this.is_done = true;
    }
}
