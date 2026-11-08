export enum Role {
    Chorister = "chorister",
    Conductor = "conductor",
    Manager = "manager",
    Admin = "admin",
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

// Partial identity and profile fields for create/update requests.
export type UserFields = {
    name?: string;
    surname?: string;
    lang?: Language;
    voice?: Voice;
    tg_username?: string;
}

// Display / sheet-bridge alias. Some older records have no @.
// Canonical identity is user.id.system_id — do not use this as a map key.
export function user_tg_username(user: UserData): string {
    return user.id.tg_username ?? "";
}

// Accepts a single role or an array of roles. Returns true if the user has
// at least one of the specified roles; an empty array returns false.
export function user_has_role(user: UserData, roles: Role | readonly Role[]): boolean {
    if (typeof roles === "string") {
        return user.roles.includes(roles);
    }
    return roles.some(role => user.roles.includes(role));
}

export function is_guest_user(user: UserData): boolean {
    return user.roles.length === 0;
}
