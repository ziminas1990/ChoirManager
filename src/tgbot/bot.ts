import * as fs from 'fs';
import * as path from 'path';
import { StatusWith } from '../status.js';
import { BotAPI } from './api/telegram.js';
import { GoogleTranslate } from './api/google_translate.js';
import TelegramBot from 'node-telegram-bot-api';
import { AnnounceTranslator } from './activities/translator.js';
import { load_database_from_file } from './database_loader.js';
import { Runtime } from './runtime.js';
import { Role } from './database.js';

type Config = {
    token: string;
    choir_group: number;
    announces_thread: number;
    google_cloud_key_file: string;
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
if (!config_status.done()) {
    console.error('Failed to load configuration:', config_status.what());
    process.exit(1);
}

const config = config_status.value!;
if (!config.token) {
    console.error('Token not found in botcfg.json');
    process.exit(1);
}

// Load database
const database_status = load_database_from_file(path.join(process.cwd(), 'data', 'users.json'));
if (!database_status.done() || database_status.value == undefined) {
    console.error('Failed to load database:', database_status.what());
    process.exit(1);
}
const database = database_status.value;

const runtime = new Runtime(database);

const translator = new AnnounceTranslator(runtime);
translator.start();

// Initialize APIs
BotAPI.init(config.token);
GoogleTranslate.init(config.google_cloud_key_file);

// Configure bot
const bot = BotAPI.instance();

bot.on("message", async (msg) => {
    if (msg.chat.type == "private") {
        handle_private_message(msg);
    } else {
        handle_group_message(msg);
    }
});

function handle_private_message(msg: TelegramBot.Message) {
    log_message(msg);

    const username = msg.from?.username;
    if (username == undefined) {
        return;
    }

    const user = runtime.get_user(username);
    const status = user.on_message(msg);
    if (!status.done()) {
        console.error(`${user.user.tgig}: ${status.what()}`);
    }
}

function log_message(msg: TelegramBot.Message) {
    if (msg.text) {
        if (!msg.text.includes("\n")) {
            console.log(`Message from ${msg.from?.username} in ${msg.chat.id}: ${msg.text}`);
        } else {
            console.log([
                "-".repeat(40),
                `Message from ${msg.from?.username} in ${msg.chat.id}:`,
                msg.text,
                "=".repeat(40),
            ].join("\n"));
        }
    } else {
        console.log(`Empty message from ${msg.from?.username} in ${msg.chat.id}`);
    }
}

function handle_group_message(msg: TelegramBot.Message) {
    log_message(msg);

    const username = msg.from?.username;
    if (username == undefined) {
        return;
    }
    const user = runtime.get_user(username);

    const is_announce = msg.chat.id == config.choir_group &&
                        msg.message_thread_id == config.announces_thread;
    const is_sent_by_manager = user.user.roles.includes(Role.Manager);

    if (is_announce && is_sent_by_manager) {
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

    let user = runtime.get_user(username);
    user.on_callback(query);
});

async function main() {
    console.log("Runnning...");
    while (true) {
        const now = new Date();
        for (const user of runtime.all_users()) {
            user.proceed(now);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

main();
