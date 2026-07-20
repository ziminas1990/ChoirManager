import fs from "fs";

import { OpenaiAPI } from "@src/api/openai.js";
import { MemoryAskJob } from "@src/components/ai/jobs/memory_ask_job.js";
import { MemorySearchJob } from "@src/components/ai/jobs/memory_search_job.js";
import { SimpleMemoryConfig } from "@src/config.js";
import {
    MemoryAccessContext,
    MemoryFact,
    NewMemoryFact,
} from "@src/entities/memory.js";
import {
    ISimpleMemoryService,
    ISimpleMemoryStorage,
} from "@src/interfaces/simple_memory.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

export class SimpleMemoryService implements ISimpleMemoryService {
    private readonly journal: Journal;
    private facts: Map<string, MemoryFact> = new Map();

    constructor(
        private readonly config: SimpleMemoryConfig,
        private readonly storage: ISimpleMemoryStorage,
        parent_journal: Journal,
    ) {
        this.journal = parent_journal.child("memory_svc");
    }

    async init(): Promise<Status> {
        const fetched = await this.storage.fetch_all();
        if (!fetched.ok) {
            return fetched.wrap_error("failed to hydrate simple memory");
        }

        this.facts = new Map(fetched.value.map((fact) => [fact.id, fact]));
        this.journal.log().info(`Hydrated ${this.facts.size} memory facts`);
        return Expected.ok(undefined);
    }

    async remember(fact: NewMemoryFact): Promise<Expected<MemoryFact>> {
        const created = await this.storage.create(fact);
        if (!created.ok) {
            return created.wrap_error("failed to remember fact");
        }

        this.facts.set(created.value.id, created.value);
        return Expected.ok(created.value);
    }

    async forget(id: string, access: MemoryAccessContext): Promise<Expected<MemoryFact>> {
        const existing = this.get_visible(id, access);
        if (!existing.ok) {
            return existing;
        }

        const deleted = await this.storage.delete(id);
        if (!deleted.ok) {
            return deleted.wrap_error("failed to forget fact");
        }

        this.facts.delete(id);
        return Expected.ok(deleted.value);
    }

    async update(
        id: string,
        content: string,
        access: MemoryAccessContext,
    ): Promise<Expected<MemoryFact>> {
        const trimmed = content.trim();
        if (trimmed.length === 0) {
            return Expected.err("updated content must be non-empty");
        }

        const existing = this.get_visible(id, access);
        if (!existing.ok) {
            return existing;
        }

        const updated_fact: MemoryFact = {
            ...existing.value,
            content: trimmed,
        };

        const stored = await this.storage.update(updated_fact);
        if (!stored.ok) {
            return stored.wrap_error("failed to update fact");
        }

        this.facts.set(stored.value.id, stored.value);
        return Expected.ok(stored.value);
    }

    async list(access: MemoryAccessContext): Promise<Expected<MemoryFact[]>> {
        const visible = Array.from(this.facts.values())
            .filter((fact) => this.is_fact_visible(fact, access));
        return Expected.ok(visible);
    }

    async get(id: string, access: MemoryAccessContext): Promise<Expected<MemoryFact>> {
        return this.get_visible(id, access);
    }

    async search(content: string, access: MemoryAccessContext): Promise<Expected<string[]>> {
        const query = content.trim();
        if (query.length === 0) {
            return Expected.err("search query must be non-empty");
        }

        if (!OpenaiAPI.is_available()) {
            return Expected.err("OpenAI API is not available");
        }

        const visible = Array.from(this.facts.values())
            .filter((fact) => this.is_fact_visible(fact, access));
        if (visible.length === 0) {
            return Expected.ok([]);
        }

        let prompt: string;
        try {
            prompt = fs.readFileSync(this.config.search_prompt_file, "utf-8").trim();
        } catch (e) {
            return Expected.exception("failed to read memory search prompt", e);
        }

        const job = new MemorySearchJob(
            OpenaiAPI.get_llm(this.config.model),
            prompt,
        );
        const result = await job.evaluate({ query, facts: visible });
        if (!result.ok) {
            return result.cast_error<string[]>().wrap_error("memory search job failed");
        }

        this.journal.log().info(
            `memory search selected ${result.value.output.ids.length} facts` +
            ` (model=${result.value.model},` +
            ` in=${result.value.usage.input_tokens},` +
            ` out=${result.value.usage.output_tokens})`,
        );

        return Expected.ok(result.value.output.ids);
    }

    async ask(question: string, access: MemoryAccessContext): Promise<Expected<string>> {
        const query = question.trim();
        if (query.length === 0) {
            return Expected.err("ask question must be non-empty");
        }

        if (!OpenaiAPI.is_available()) {
            return Expected.err("OpenAI API is not available");
        }

        const search_result = await this.search(query, access);
        if (!search_result.ok) {
            return search_result.cast_error<string>().wrap_error("memory ask search failed");
        }

        const facts: MemoryFact[] = [];
        for (const id of search_result.value) {
            const fact = this.get_visible(id, access);
            if (!fact.ok) {
                this.journal.log().warn(`memory ask skipped id '${id}': ${fact.error}`);
                continue;
            }
            facts.push(fact.value);
        }

        let prompt: string;
        try {
            prompt = fs.readFileSync(this.config.ask_prompt_file, "utf-8").trim();
        } catch (e) {
            return Expected.exception("failed to read memory ask prompt", e);
        }

        const job = new MemoryAskJob(
            OpenaiAPI.get_llm(this.config.model),
            prompt,
        );
        const result = await job.evaluate({ question: query, facts });
        if (!result.ok) {
            return result.cast_error<string>().wrap_error("memory ask job failed");
        }

        this.journal.log().info(
            `memory ask answered from ${facts.length} facts` +
            ` (model=${result.value.model},` +
            ` in=${result.value.usage.input_tokens},` +
            ` out=${result.value.usage.output_tokens})`,
        );

        return Expected.ok(result.value.output.answer);
    }

    private get_visible(id: string, access: MemoryAccessContext): Expected<MemoryFact> {
        const fact = this.facts.get(id);
        if (!fact) {
            return Expected.err(`memory '${id}' not found`);
        }
        if (!this.is_fact_visible(fact, access)) {
            return Expected.err(`memory '${id}' is not visible`);
        }
        return Expected.ok(fact);
    }

    private is_fact_visible(fact: MemoryFact, access: MemoryAccessContext): boolean {
        switch (fact.visibility.kind) {
            case "global":
                return true;
            case "specific_user":
                // Group-only access (no user_id) never sees user-scoped facts.
                if (!access.user_id) {
                    return false;
                }
                return fact.visibility.user_id === access.user_id
                    || fact.author_user_id === access.user_id;
            case "specific_group":
                return access.group_ids.includes(fact.visibility.group_id);
        }
    }
}
