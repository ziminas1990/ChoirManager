import * as fs from 'fs';
import * as path from 'path';
import { Status } from '../status.js';
import { BotAPI } from './api/telegram.js';
import { GoogleDocsAPI } from './api/google_docs.js';
import { GoogleTranslate } from './api/google_translate.js';
import { load_database_from_file } from './database_loader.js';
import { Runtime } from './runtime.js';
import { Config } from './config.js';
import { OpenaiAPI } from "./api/openai.js";

// Loading configuration
{
    const cfgfile = path.join(process.cwd(), 'config', 'botcfg.json');
    const status = Config.Load(cfgfile);
    if (!status.done()) {
        console.error(`Failed to load configuration from ${cfgfile}: ${status.what()}`);
        process.exit(1);
    }
    if (status.has_warnings()) {
        console.warn("Warnings while loading configuration:", status.what());
    }
}

// Load database
const database_status = load_database_from_file(Config.data.database_filename);
if (!database_status.done() || database_status.value == undefined) {
    console.error('Failed to load database:', database_status.what());
    process.exit(1);
}
const database = database_status.value;

// Loading runtime data
const runtime_status = Runtime.Load(Config.data.runtime_cache_filename, database);
if (!runtime_status.done() || runtime_status.value == undefined) {
    console.error('Failed to load runtime:', runtime_status.what());
    process.exit(1);
}
if (!runtime_status.ok()) {
    console.warn(`Problem occurred while loading runtime:\n${runtime_status.what()}`);
}
const runtime = runtime_status.value;

// Initialize APIs
const tg_token = fs.readFileSync(Config.data.tgbot_token_file, 'utf-8');
if (!tg_token) {
    console.error('Error: Token not found in tgbot_token');
    process.exit(1);
}

if (Config.HasOpenAI()) {
    const status = OpenaiAPI.init();
    if (!status.ok()) {
        console.error(`Failed to initialize OpenAI API: ${status.what()}`);
        process.exit(1);
    }
}

{
    const status = GoogleDocsAPI.authenticate(Config.data.google_cloud_key_file);
    if (!status.ok()) {
        console.error(`Failed to initialize Google Docs API: ${status.what()}`);
        process.exit(1);
    }
}

GoogleTranslate.init(Config.data.google_cloud_key_file);

BotAPI.init(tg_token.split('\n')[0].trim());

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

bot.on("callback_query", (query) => {
    const status = runtime.handle_callback(query);
    if (!status.ok()) {
        console.error(`${status.what()}`);
    }
});

async function main() {
    console.log("Runnning...");
    const status = await runtime.start();
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
