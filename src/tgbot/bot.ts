import * as fs from 'fs';
import * as path from 'path';
import { Status, StatusWith } from '../status.js';
import { BotAPI } from './api/telegram.js';
import { GoogleTranslate } from './api/google_translate.js';
import { load_database_from_file } from './database_loader.js';
import { Runtime } from './runtime.js';

type Config = {
    database_filename: string;
    runtime_cache_filename: string;
    google_cloud_key_file: string;
    tgbot_token_file: string;
    runtime_dump_interval_sec: number;
}

function load_configuration(): StatusWith<Config> {
    const config_path = path.join(process.cwd(), 'config', 'botcfg.json');
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
if (!config_status.done() || config_status.value == undefined) {
    console.error('Failed to load configuration:', config_status.what());
    process.exit(1);
}

const config = config_status.value!;

// Load database
const database_status = load_database_from_file(config.database_filename);
if (!database_status.done() || database_status.value == undefined) {
    console.error('Failed to load database:', database_status.what());
    process.exit(1);
}
const database = database_status.value;

// Loading runtime data
const runtime_status = Runtime.Load(config.runtime_cache_filename, database);
if (!runtime_status.done() || runtime_status.value == undefined) {
    console.error('Failed to load runtime:', runtime_status.what());
    process.exit(1);
}
if (!runtime_status.ok()) {
    console.warn(`Problem occurred while loading runtime:\n${runtime_status.what()}`);
}
const runtime = runtime_status.value;

// Initialize APIs
const tg_token = fs.readFileSync(config.tgbot_token_file, 'utf-8');
if (!tg_token) {
    console.error('Error: Token not found in tgbot_token');
    process.exit(1);
}

BotAPI.init(tg_token.split('\n')[0].trim());
GoogleTranslate.init(config.google_cloud_key_file);

// Configure bot
const bot = BotAPI.instance();

bot.on("message", async (msg) => {
    const status: Status = msg.chat.type == "private" ?
        runtime.handle_private_message(msg) :
        runtime.handle_group_message(msg);

    if (!status.ok()) {
        console.error(`${status.what()}`);
    }
});

// Обработка выбора файла
bot.on("callback_query", (query) => {
    const status = runtime.handle_callback(query);
    if (!status.ok()) {
        console.error(`${status.what()}`);
    }
});

async function main() {
    console.log("Runnning...");
    const status = await runtime.start(config.runtime_dump_interval_sec, config.google_cloud_key_file);
    if (!status.ok()) {
        console.error(`${status.what()}`);
        process.exit(1);
    }

    while (true) {
        await runtime.proceed(new Date());
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

main();
