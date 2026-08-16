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

// Display / sheet-bridge alias. Some guests and older records have no @.
// Canonical identity is user.id.system_id — do not use this as a map key.
export function user_tg_username(user: UserData): string {
    return user.id.tg_username ?? "";
}

export function user_has_role(user: UserData, role: Role): boolean {
    return user.roles.includes(role);
}
