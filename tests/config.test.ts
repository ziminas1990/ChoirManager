import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MemoryJournal } from "@src/components/memory_journal.js";
import { load_config } from "@src/config.js";

test("configuration loading forwards diagnostics to the selected journal", t => {
    // Motivation: startup warnings must be observable without replacing a
    // module-owned logger or intercepting console and backend methods.

    // 1. create a valid configuration using a deprecated model in two services
    let filename;
    const journal = new MemoryJournal();
    const startup = journal.child("startup");
    {
        const directory = mkdtempSync(join(tmpdir(), "choir-config-journal-"));
        t.after(() => rmSync(directory, { recursive: true, force: true }));
        filename = join(directory, "botcfg.json");
        const storage = { type: "google_firestore", database_id: "test", collection_name: "users" };
        writeFileSync(filename, JSON.stringify({
            runtime_cache_filename: "runtime.json", runtime_dump_interval_sec: 10,
            logs_file: "bot.log", google_cloud_key_file: "google.json",
            openai_api_key_file: "openai.key",
            tg_adapter: { token_file: "telegram.key", formatting: "html", users_storage: storage },
            user_service: { type: "local", storage },
            messages_provider: { sheet_id: "test", table_name: "Messages" },
            assistant: { model: "gpt-4o", prompt_file: "config/prompts/chorister_agent.md" },
            simple_memory: {
                type: "local", model: "gpt-4o", storage,
                search_prompt_file: "config/prompts/memory_service_search_prompt.md",
                ask_prompt_file: "config/prompts/memory_service_ask_prompt.md",
            },
        }));
    }

    // 2. load the configuration and inspect startup warnings through the root
    let config;
    {
        const loaded = load_config(filename, startup);
        assert.equal(loaded.ok, true, loaded.ok ? undefined : loaded.error);
        config = loaded.value;
        const records = journal.records;
        assert.equal(records.length, 3);
        assert.ok(records.every(record => record.level === "warning"));
        assert.match(records[0].message, /scores_service.*DISABLED/);
        assert.match(records[1].message, /deposit_service.*DISABLED/);
        assert.equal(records[0].component, "startup");
        assert.equal(records[2].component, "startup.openai_models");
        assert.equal(records[2].fields.model, "gpt-4o");
    }

    // 3. revalidate without repeating the model warning for the same journal
    {
        assert.equal(config.verify(startup).ok, true);
        assert.equal(journal.records.filter(record => record.fields.model === "gpt-4o").length, 1);
    }

    // 4. let an independent caller observe its own model warning
    {
        const other = new MemoryJournal();
        assert.equal(config.verify(other).ok, true);
        assert.equal(other.records.filter(record => record.fields.model === "gpt-4o").length, 1);
        assert.equal(journal.records.length, 5);
    }
});
