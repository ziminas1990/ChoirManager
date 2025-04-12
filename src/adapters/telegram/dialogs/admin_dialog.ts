import { IAdminAgent, IUserAgent } from "@src/interfaces/user_agent.js";
import { TelegramUser } from "@src/adapters/telegram/telegram_user.js";
import { GlobalFormatter } from "@src/utils.js";
import { Status } from "@src/status.js";

export class AdminDialog implements IAdminAgent {
    constructor(private user: TelegramUser) {}

    base(): IUserAgent {
        return this.user;
    }

    async send_notification(message: string): Promise<Status> {
        const formatter = GlobalFormatter.instance();
        return await this.user.send_message([
            formatter.bold("Admin's notification:"),
            "",
            message,
        ].join("\n"));
    }

    async send_runtime_backup(filepath: string): Promise<Status> {
        return await this.user.send_file(filepath);
    }

    async send_logs(filepath: string): Promise<Status> {
        return await this.user.send_file(filepath);
    }
}
