import * as fs from 'fs';
import * as path from 'path';
import { Status, StatusWith } from '../status.js';
import { User } from './items/user.js';
import { BotAPI } from './globals.js';
import TelegramBot from 'node-telegram-bot-api';
import { TranslatorActivity } from './activities/translator.js';

type Config = {
    token: string;
    choir_group: number;
    announces_thread: number;
}

function load_configuration(): StatusWith<Config> {
    const config_path = path.join(process.cwd(), 'botcfg.json');
    try {
        const raw = fs.readFileSync(config_path, 'utf-8');
        const config = JSON.parse(raw) as Config;
        return StatusWith.ok().with(config);
    } catch (error) {
        if (error instanceof Error) {
            return StatusWith.fail(error.message);
        }
        return StatusWith.fail(`${error}`);
    }
}

const config_status = load_configuration();
if (!config_status.is_ok()) {
    console.error('Failed to load configuration:', config_status.what());
    process.exit(1);
}

const config = config_status.value!;
if (!config.token) {
    console.error('Token not found in botcfg.json');
    process.exit(1);
}

BotAPI.init(config.token);

const bot = BotAPI.instance();

function check_user_json(user_json: any): Status {
    const expected_keys_and_types = {
        name: 'string',
        surname: 'string',
        tgig: 'string',
    };

    for (const [key, type] of Object.entries(expected_keys_and_types)) {
        if (typeof user_json[key] !== type) {
            return Status.fail(`${key} is not a ${type} or is missing`);
        }
        if (user_json.lang && user_json.lang !== "ru" && user_json.lang !== "en") {
            return Status.fail(`lang is not a "ru" or "en"`);
        }
    }

    return Status.ok();
}

function load_users(): StatusWith<User[]> {
    const users_path = path.join(process.cwd(), 'src/data/users.json');
    const raw = fs.readFileSync(users_path, 'utf-8');
    if (!raw) {
        return StatusWith.fail('users.json is empty');
    }

    let next_user_id = 1;

    const users_json = JSON.parse(raw) as {
        name: string;
        surname: string;
        roles: string[];
        tgig: string;
        lang: string | undefined;
    }[];

    const users = users_json.map((user_json) => {
        const check_status = check_user_json(user_json);
        if (!check_status.is_ok()) {
            console.error(`User ${user_json.name ?? 'unknown'} is invalid: ${check_status.what()}`);
            return undefined;
        }

        return new User(
            next_user_id++,
            user_json.name,
            user_json.surname,
            user_json.roles,
            user_json.tgig,
            user_json.lang ? user_json.lang as "ru" | "en" : "ru"
        );
    }).filter((user) => user !== undefined) as User[];

    return StatusWith.ok().with(users);
}

const users_status = load_users();
if (!users_status.is_ok()) {
    console.error('Failed to load users:', users_status.what());
    process.exit(1);
}


const users: Map<string, User> = new Map(users_status.value!.map(user => [user.tgig.slice(1), user]));
const guest = new User(0, "Guest", "", [], "");

const translator = new TranslatorActivity(users);
translator.start();

bot.on("message", async (msg) => {
    if (msg.chat.type == "private") {
        handle_private_message(msg);
    } else {
        handle_group_message(msg);
    }
});

function handle_private_message(msg: TelegramBot.Message) {
    const username = msg.from?.username;
    console.log(`Message from ${username} in ${msg.chat.id}: ${msg.text}`);
    if (username == undefined) {
        return;
    }

    let user = users.get(username);
    if (user == undefined) {
        user = guest;
    }

    user.on_message(msg);
}

function handle_group_message(msg: TelegramBot.Message) {
    console.log(`Message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);

    const is_announce = msg.chat.id == config.choir_group &&
                        msg.message_thread_id == config.announces_thread;
    if (is_announce) {
        translator.on_announce(msg);
    }
}

// Обработка выбора файла
bot.on("callback_query", (query) => {
    const username = query.from?.username

    console.log(`Callback query from ${username} in ${query.message?.chat.id}: ${query.data}`);

    if (username == undefined) {
        return;
    }

    let user = users.get(username);
    if (user == undefined) {
        user = guest;
    }

    user.on_callback(query);
});

async function main() {
    const all_users = Array.from(users.values());
    all_users.push(guest);

    console.log("Runnning...");
    while (true) {
        const now = new Date();
        for (const user of all_users) {
            user.proceed(now);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

main();