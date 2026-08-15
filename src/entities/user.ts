export enum Role {
    Chorister = "chorister",
    Conductor = "conductor",
    Manager = "manager",
    Admin = "admin",
    Guest = "guest",
    Accountant = "accountant",
    ExChorister = "ex-chorister",
}

export enum Voice {
    Alto = "alto",
    Soprano = "soprano",
    Tenor = "tenor",
    Baritone = "baritone",
    Unknown = "unknown",
}

export enum Language {
    RU = "ru",
    EN = "en",
}

export type UserId = {
    system_id: string;  // internal system uuid for the user
    tg_username?: string;  // telegram username
}

export type UserData = {
    id: UserId;
    name: string;
    surname: string;
    lang: Language;
    voice: Voice;
    roles: Role[];
}

export function user_tg_username(user: UserData): string {
    if (!user.id.tg_username) {
        throw new Error(`user '${user.id.system_id}' has no telegram_id`);
    }
    return user.id.tg_username;
}

export function user_has_role(user: UserData, role: Role): boolean {
    return user.roles.includes(role);
}
