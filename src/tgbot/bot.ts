import * as fs from 'fs';
import * as path from 'path';
import { Status, StatusWith } from '../status.js';
import { BotAPI } from './api/telegram.js';
import { GoogleDocsAPI } from './api/google_docs.js';
import { GoogleTranslate } from './api/google_translate.js';
import { Runtime } from './runtime.js';
import { Config } from './config.js';
import { OpenaiAPI } from "./api/openai.js";
import { UsersFetcher } from './fetchers/users_fetcher.js';
import { Database } from './database.js';
import pino from "pino";

const root_logger = pino({
    formatters: {
        bindings: () => ({}),
        level: (label) => ({ level: label.toUpperCase() }),
    }
});

// Loading configuration
function load_config() {
    const cfgfile = path.join(process.cwd(), 'config', 'botcfg.json');
    const status = Config.Load(cfgfile);
    if (!status.done()) {
        root_logger.error(`Failed to load configuration from ${cfgfile}: ${status.what()}`);
        process.exit(1);
    }
    if (status.has_warnings()) {
        root_logger.warn(`Warnings while loading configuration: ${status.what()}`);
    }
}

function init_openai_api(): Status {
    if (!Config.HasOpenAI()) {
        return Status.ok();
    }
    root_logger.info("Initializing OpenAI API...");
    return OpenaiAPI.init();
}

function init_telegram_api(): Status {
    try {
        const tg_token = fs.readFileSync(Config.data.tgbot_token_file, 'utf-8');
        if (!tg_token) {
            return Status.fail("Telegram token not found");
        }
        BotAPI.init(tg_token.split('\n')[0].trim());
    } catch (e) {
        return Status.fail(`Failed to initialize Telegram API: ${e}`);
    }
    return Status.ok();
}

function bind_telegram_events(runtime: Runtime) {
    const bot = BotAPI.instance();

    bot.on("message", async (msg) => {
        const status = msg.chat.type == "private" ?
            await runtime.handle_private_message(msg) :
            await runtime.handle_group_message(msg);

        if (!status.ok()) {
            root_logger.error(`${status.what()}`);
        }
    });

    bot.on("callback_query", (query) => {
        const status = runtime.handle_callback(query);
        if (!status.ok()) {
            root_logger.error(`${status.what()}`);
        }
    });
}

async function load_database(database: Database, users_fetcher: UsersFetcher): Promise<Status> {
    const status = await users_fetcher.start();
    if (!status.ok()) {
        return status.wrap("can't start users fetcher");
    }

    const verify_status = database.verify();
    if (!verify_status.ok()) {
        return verify_status.wrap("can't verify database");
    }

    return StatusWith.ok();
}

async function wait_and_exit(wait_ms: number, exit_code: number) {
    await new Promise(resolve => setTimeout(resolve, wait_ms));
    process.exit(exit_code);
}

async function main() {
    root_logger.info("Preparing...");
    load_config();

    root_logger.info("Initializing Google Docs API...");
    {
        const status = GoogleDocsAPI.authenticate(Config.data.google_cloud_key_file);
        if (!status.ok()) {
            root_logger.error(`Failed to initialize Google Docs API: ${status.what()}`);
            await wait_and_exit(10000, 1);
        }
    }

    const database = new Database();
    const users_fetcher = new UsersFetcher(database);

    root_logger.info("Loading database...");
    const database_status = await load_database(database, users_fetcher);
    if (!database_status.ok()) {
        root_logger.error(`Failed to load database: ${database_status.what()}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.info("Loading runtime...");
    const runtime_status = Runtime.Load(Config.data.runtime_cache_filename, database, root_logger);
    if (!runtime_status.done() || runtime_status.value == undefined) {
        root_logger.error(`Failed to load runtime: ${runtime_status.what()}`);
        await wait_and_exit(10000, 1);
    }
    const runtime = runtime_status.value!;
    runtime.attach_users_fetcher(users_fetcher);

    const openai_status = init_openai_api();
    if (!openai_status.ok()) {
        root_logger.error(`Failed to initialize OpenAI API: ${openai_status.what()}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.info("Initializing Google Translate API...");
    GoogleTranslate.init(Config.data.google_cloud_key_file);

    root_logger.info("Initializing Telegram API...");
    const telegram_status = init_telegram_api();
    if (!telegram_status.ok()) {
        root_logger.error(`Failed to initialize Telegram API: ${telegram_status.what()}`);
        await wait_and_exit(10000, 1);
    }
    bind_telegram_events(runtime);

    root_logger.info("Starting runtime...");
    const status = await runtime.start();
    if (!status.ok()) {
        root_logger.error(`${status.what()}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.info("Runnning...");
    while (true) {
        await runtime.proceed(new Date());
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

try {
    main();
} catch (e) {
    root_logger.error(`Unhandled exception: ${e}`);
    wait_and_exit(10000, 1);
}
