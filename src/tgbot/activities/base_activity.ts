import TelegramBot from "node-telegram-bot-api";
import { Dialog } from "../logic/dialog";
import { Status } from "../../status";

export class BaseActivity {

    private is_done: boolean = false;

    constructor(protected readonly dialog: Dialog)
    {}

    proceed(_: Date): void {}

    start(): void {
        throw new Error("Not implemented");
    }

    on_message(_: TelegramBot.Message): Status {
        throw new Error("Not implemented");
    }

    on_callback(_: TelegramBot.CallbackQuery): Status {
        throw new Error("Not implemented");
    }

    done(): boolean {
        return this.is_done;
    }

    protected set_done(): void {
        this.is_done = true;
    }
}
