import { BotCommand } from "node-telegram-bot-api";

import { Language, Role, UserData, user_has_role } from "@src/entities/user.js";

type Command = BotCommand & { emoji: string; roles: readonly Role[]; allow_guest?: boolean };

export class TelegramCommands {
    static for_user(user: UserData): BotCommand[] {
        return this.list(user.lang)
            .filter(command => user_has_role(user, command.roles)
                || (command.allow_guest && user.roles.length === 0))
            .map(({ command, description, emoji }) => ({ command, description: `${emoji} ${description}` }));
    }

    static parse(text: string, lang: Language): string | undefined {
        if (text.startsWith("/")) {
            return text.split(/\s/)[0].split("@")[0];
        }
        // Accept buttons still visible until the next bot reply removes them.
        if (text === "🔄") {
            return "/start";
        }
        const command = this.list(lang).find(item => item.command !== "start" && item.description === text);
        return command ? `/${command.command}` : undefined;
    }

    private static list(lang: Language): Command[] {
        const ru = lang === Language.RU;
        return [
            { command: "start",
                emoji: "🔄",
                description: ru ? "Начать разговор заново" : "Restart conversation",
                roles: [
                    Role.Chorister,
                    Role.Conductor,
                    Role.Manager,
                    Role.Admin,
                    Role.Accountant,
                    Role.ExChorister
                ], allow_guest: true },
            { command: "deposit", emoji: "💰", description: ru ? "Мой депозит" : "My deposit",
                roles: [Role.Chorister, Role.Manager, Role.Admin] },
            { command: "statistics", emoji: "📊", description: ru ? "Статистика" : "Statistics",
                roles: [Role.Chorister, Role.Manager, Role.Admin] },
            { command: "feedback", emoji: "💬", description: ru ? "Обратная связь" : "Leave a feedback",
                roles: [Role.Chorister, Role.Manager, Role.Admin] },
            { command: "scores", emoji: "🎼", description: ru ? "Скачать ноты" : "Download scores",
                roles: [Role.Chorister, Role.Manager, Role.Admin] },
        ];
    }
}
