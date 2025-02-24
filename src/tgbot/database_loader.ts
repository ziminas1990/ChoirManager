import { StatusWith } from "../status.js";
import { Database, Language, Role, User } from "./database.js";

import fs from "fs";

type UserJson = {
    name: string;
    surname: string;
    roles: string[];
    tgig: string;
    lang: string | undefined;
}

let next_user_id = 1;

const globals = {
    next_user_id: 1,
    valid_roles: new Map(Object.values(Role).map((v) => [v.toString(), v])),
    valid_langs: ["ru", "en"],
}

function read_role(role: string): StatusWith<Role> {
    if (!globals.valid_roles.has(role)) {
        return StatusWith.fail(`Invalid role: ${role}`);
    }
    return StatusWith.ok().with(globals.valid_roles.get(role)!);
}

function read_lang(lang: string): StatusWith<Language> {
    if (!globals.valid_langs.includes(lang)) {
        return StatusWith.fail(`Invalid lang: ${lang}`);
    }
    return StatusWith.ok().with(lang as Language);
}

function load_user(user_json: UserJson): StatusWith<User> {
    const error_prefix = `User ${user_json.name} ${user_json.surname} (${user_json.tgig})`;

    const roles: Role[] = [];
    for (const role of user_json.roles) {
        const role_status = read_role(role);
        if (!role_status.is_ok() || role_status.value == undefined) {
            return role_status.wrap(error_prefix);
        }
        roles.push(role_status.value);
    }

    const lang_status = read_lang(user_json.lang ?? "ru");
    if (!lang_status.is_ok() || lang_status.value == undefined) {
        console.log("lang", lang_status.what());
        return lang_status.wrap(error_prefix);
    }

    const user = new User(
        next_user_id++, user_json.name, user_json.surname,
        roles,
        user_json.tgig.startsWith("@") ? user_json.tgig.slice(1) : user_json.tgig,
        lang_status.value);

    return StatusWith.ok().with(user);
}

function load_users(users_json: UserJson[]): StatusWith<User[]> {
    const users: User[] = [];
    for (const user_json of users_json) {
        const user_status = load_user(user_json);
        if (!user_status.is_ok() || user_status.value == undefined) {
            return user_status.with(users);
        }
        users.push(user_status.value);
    }
    return StatusWith.ok().with(users);
}

export function load_database(users_json: UserJson[]): StatusWith<Database> {
    const users_status = load_users(users_json);
    if (!users_status.is_ok() || users_status.value == undefined) {
        return users_status.with<Database>(undefined);
    }
    return StatusWith.ok().with(new Database(users_status.value));
}

export function load_database_from_file(path: string): StatusWith<Database> {
    const users_json = JSON.parse(fs.readFileSync(path, 'utf-8')) as UserJson[];
    return load_database(users_json);
}
