import * as path from 'path';
import { Expected, Status } from "@src/utils/expected.js";
import { GoogleAuth } from '@src/api/google_auth.js';
import { GoogleTranslate } from '@src/api/google_translate.js';
import { Runtime } from '@src/runtime.js';
import { BotConfig, load_config } from '@src/config.js';
import { OpenaiAPI } from "@src/api/openai.js";
import { UsersFetcher } from '@src/fetchers/users_fetcher.js';
import { UsersStorageFactory } from '@src/adapters/users_storage/factory.js';
import { UserServiceFactory } from '@src/adapters/user_service/factory.js';
import { Database } from '@src/database.js';
import { Journal } from '@src/journal.js';
import { GlobalFormatter } from '@src/utils.js';
import { CoreAPI } from '@src/use_cases/core.js';
import { UserService } from '@src/components/user_service.js';
import { Environment } from '@src/components/environment.js';

const root_logger = Journal.Root();

// Loading configuration
function load_bot_config(): BotConfig {
    const cfgfile = path.join(process.cwd(), 'config', 'botcfg.json');
    const status = load_config(cfgfile);
    if (!status.ok) {
        root_logger.log().error(`Failed to load configuration from ${cfgfile}: ${status.error}`);
        process.exit(1);
    }
    return status.value!;
}

function init_openai_api(config: BotConfig): Status {
    if (!config.json.openai_api_key_file) {
        return Expected.ok(undefined);
    }
    root_logger.log().info("Initializing OpenAI API...");
    return OpenaiAPI.init(config);
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

async function load_user_service(config: BotConfig): Promise<Expected<UserService>> {
    const create_status = UserServiceFactory.create(config.user_service!, root_logger);
    if (!create_status.ok) {
        return create_status.wrap_error("can't create user service");
    }

    const user_service = create_status.value;
    const init_status = await user_service.init();
    if (!init_status.ok) {
        return init_status.wrap_error("can't init user service");
    }
    return Expected.ok(user_service);
}

async function wait_and_exit(wait_ms: number, exit_code: number) {
    await new Promise(resolve => setTimeout(resolve, wait_ms));
    process.exit(exit_code);
}

async function main() {
    root_logger.log().info("Preparing...");
    const config = load_bot_config();

    GlobalFormatter.init(config.tg_adapter!.formatting);

    const environment = new Environment();
    Environment.set_global(environment);

    const operations_journal = root_logger.child("operations");
    CoreAPI.attach_journal(operations_journal.child("core_api"));

    root_logger.log().info("Initializing Google Auth...");
    {
        const status = await GoogleAuth.authenticate(config.json.google_cloud_key_file);
        if (!status.ok) {
            root_logger.log().error(`Google auth failed: ${status.error}`);
            await wait_and_exit(10000, 1);
        }
    }

    const database = new Database();
    const users_storage_status = UsersStorageFactory.create(
        config.users_fetcher!.storage,
        root_logger,
    );
    if (!users_storage_status.ok) {
        root_logger.log().error(`Failed to create users storage: ${users_storage_status.error}`);
        await wait_and_exit(10000, 1);
    }
    const users_fetcher = new UsersFetcher(
        users_storage_status.value,
        config.users_fetcher!.fetch_interval_sec,
        database,
        root_logger,
    );

    root_logger.log().info("Initializing user service...");
    const user_service_status = await load_user_service(config);
    if (!user_service_status.ok) {
        root_logger.log().error(`Failed to load user service: ${user_service_status.error}`);
        await wait_and_exit(10000, 1);
    }
    const user_service = user_service_status.value!;
    environment.user_service = user_service;

    root_logger.log().info("Loading database...");
    const database_status = await load_database(database, users_fetcher);
    if (!database_status.ok) {
        root_logger.log().error(`Failed to load database: ${database_status.error}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.log().info("Loading runtime...");
    const runtime_status = Runtime.Load(config, database, root_logger);
    if (!runtime_status.ok) {
        root_logger.log().error(`Failed to load runtime: ${runtime_status.error}`);
        await wait_and_exit(10000, 1);
    }
    const runtime = runtime_status.value!;
    runtime.attach_users_fetcher(users_fetcher);
    runtime.attach_user_service(user_service);

    const openai_status = init_openai_api(config);
    if (!openai_status.ok) {
        root_logger.log().error(`Failed to initialize OpenAI API: ${openai_status.error}`);
        await wait_and_exit(10000, 1);
    }

    root_logger.log().info("Initializing Google Translate API...");
    GoogleTranslate.init(config.json.google_cloud_key_file);

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
