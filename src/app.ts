import * as path from 'path';
import { Expected, Status } from "@src/utils/expected.js";
import { GoogleAuth } from '@src/api/google_auth.js';
import { GoogleTranslate } from '@src/api/google_translate.js';
import { Runtime } from '@src/runtime.js';
import { Config } from '@src/config.js';
import { OpenaiAPI } from "@src/api/openai.js";
import { UsersFetcher } from '@src/fetchers/users_fetcher.js';
import { Database } from '@src/database.js';
import { Journal } from '@src/journal.js';
import { GlobalFormatter } from '@src/utils.js';
import { CoreAPI } from '@src/use_cases/core.js';

const root_logger = Journal.Root();

// Loading configuration
function load_config() {
    const cfgfile = path.join(process.cwd(), 'config', 'botcfg.json');
    const status = Config.Load(cfgfile);
    if (!status.ok) {
        root_logger.log().error(`Failed to load configuration from ${cfgfile}: ${status.error}`);
        process.exit(1);
    }
}

function init_openai_api(): Status {
    if (!Config.HasOpenAI()) {
        return Expected.ok(undefined);
    }
    root_logger.log().info("Initializing OpenAI API...");
    return OpenaiAPI.init();
}

async function load_database(database: Database, users_fetcher: UsersFetcher): Promise<Status> {
    const status = await users_fetcher.start();
    if (!status.ok) {
        return status.wrap_error("can't start users fetcher");
    }

    const verify_status = database.verify();
    if (!verify_status.ok) {
        return verify_status.wrap_error("can't verify database");
    }

    return Expected.ok(undefined);
}

async function wait_and_exit(wait_ms: number, exit_code: number) {
    await new Promise(resolve => setTimeout(resolve, wait_ms));
    process.exit(exit_code);
}

async function main() {
    root_logger.log().info("Preparing...");
    load_config();

    GlobalFormatter.init(Config.data.tg_adapter.formatting);

    const operations_journal = root_logger.child("operations");
    CoreAPI.attach_journal(operations_journal.child("core_api"));

    root_logger.log().info("Initializing Google Auth...");
    {
        const status = await GoogleAuth.authenticate(Config.data.google_cloud_key_file);
        if (!status.ok) {
            root_logger.log().error(`Google auth failed: ${status.error}`);
            await wait_and_exit(10000, 1);
        }
    }

    const database = new Database();
    const users_fetcher = new UsersFetcher(database, root_logger);

    root_logger.log().info("Loading database...");
    const database_status = await load_database(database, users_fetcher);
    if (!database_status.ok) {
        root_logger.log().error(`Failed to load database: ${database_status.error}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.log().info("Loading runtime...");
    const runtime_status = Runtime.Load(database, root_logger);
    if (!runtime_status.ok) {
        root_logger.log().error(`Failed to load runtime: ${runtime_status.error}`);
        await wait_and_exit(10000, 1);
    }
    const runtime = runtime_status.value!;
    runtime.attach_users_fetcher(users_fetcher);

    const openai_status = init_openai_api();
    if (!openai_status.ok) {
        root_logger.log().error(`Failed to initialize OpenAI API: ${openai_status.error}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.log().info("Initializing Google Translate API...");
    GoogleTranslate.init(Config.data.google_cloud_key_file);

    root_logger.log().info("Starting runtime...");
    const status = await runtime.start();
    if (!status.ok) {
        root_logger.log().error(`${status.error}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.log().info("Runnning...");
    while (true) {
        await runtime.proceed(new Date());
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

try {
    main();
} catch (e) {
    root_logger.log().error(`Unhandled exception: ${e}`);
    wait_and_exit(10000, 1);
}
