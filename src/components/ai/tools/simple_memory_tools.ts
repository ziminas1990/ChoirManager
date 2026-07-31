import { z } from "zod";

import { user_tgid } from "@src/entities/user.js";
import {
    MemoryAccessContext,
    MemoryFact,
    MemoryVisibility,
} from "@src/entities/memory.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { ISimpleMemoryService } from "@src/interfaces/simple_memory_service.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Expected } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";

const remember_schema = z.object({
    author_user_id: z.string().trim().min(1).optional()
        .describe("Telegram user_id (username without @) of who asked to remember the fact."),
    content: z.string().trim().min(1)
        .describe(
            "Normalized self-contained fact statement to store. "
            + "Not a verbatim user quote: rewrite with enough context to stand alone.",
        ),
}).strict();

const search_schema = z.object({
    content: z.string().trim().min(1)
        .describe("Search query used to find relevant memory fact ids."),
}).strict();

const get_schema = z.object({
    fact_id: z.string().trim().min(1)
        .describe("Fact id returned by search or remember."),
}).strict();

const update_schema = z.object({
    fact_id: z.string().trim().min(1)
        .describe("Fact id of the fact to update."),
    content: z.string().trim().min(1)
        .describe("New fact text. Visibility and author are unchanged."),
}).strict();

const ask_schema = z.object({
    question: z.string().trim().min(1)
        .describe(
            "Self-contained question for the memory sub-agent. "
            + "Must include all needed dialog context; the sub-agent has none.",
        ),
}).strict();

// Agent-facing fact shape: no access-control fields.
type SerializableMemoryFact = {
    fact_id: string;
    created_at: string;
    author: string;
    content: string;
};

const MEMORY_USE_CASES = `
If the user asks something that is clearly not available in the current conversation context you MUST:
- call ask with a self-contained question
- the memory sub-agent has NO dialog context, so question must include every detail needed
  to understand and answer (names, dates, what was meant, constraints)
- send a message based on the answer provided by the tool

If the user explicitly asks to remember a new fact:
- call remember tool
- normalize content before storing: do NOT save the user's words verbatim
- rewrite as a self-contained statement that keeps its meaning without the surrounding chat
  (resolve pronouns, fill in implied subjects/objects, include needed context)
- after success, send a confirmation message along with the added fact

If the user explicitly asks to find / show matching memory records (a list of facts, not an answer):
- call search with the search content
- call get for every returned fact_id
- discard facts that do not precisely match the user's request
- send the user a list of matching facts, or say that no such records were found
- never show fact_id to the user unless the user explicitly asked for it

If any memory tool call fails:
- send a short message that the request could not be completed and include the error reason

General rules:
- Never invent memory facts
- Never list or dump all memory facts; there is no tool for that
- Never show fact_id to the user unless the user explicitly asked for it. Use it only as an internal identifier between search/remember and get.
`.trim();

export class SimpleMemoryTools implements IToolchain {
    constructor(
        private readonly memory: ISimpleMemoryService,
        private readonly access: MemoryAccessContext,
        private readonly default_visibility: MemoryVisibility,
        private readonly users: IUserServiceReplica,
    ) {}

    get_name(): string {
        return "simple_memory";
    }

    get_readme(): string {
        return [
            "Tools for storing and consulting durable memory facts.",
            "Use ask whenever a factual answer is missing from the current conversation context.",
            "Never claim ignorance about a remembered fact without calling ask first.",
            "Use remember when you need to remember some fact for future use.",
            "Use search + get when you need to find matching fact records.",
            "Use update to modify the content of an existing fact.",
        ].join("\n");
    }

    get_use_cases(): string {
        return MEMORY_USE_CASES;
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["remember", tool_from_schema(
                "remember",
                [
                    "Store a new fact in memory.",
                    "Returns fact_id of the created fact.",
                    "Call only when the user explicitly asked to remember something.",
                    "Pass content as a normalized self-contained statement, not a verbatim quote.",
                ].join("\n"),
                remember_schema,
            )],
            ["search", tool_from_schema(
                "search",
                [
                    "Search memory for fact ids relevant to the given content.",
                    "Returns only ids; call get for each id to load full facts.",
                    "Prefer ask when you need a ready-made answer, not a list of records.",
                ].join("\n"),
                search_schema,
            )],
            ["get", tool_from_schema(
                "get",
                "Get one memory fact by fact_id.",
                get_schema,
            )],
            ["update", tool_from_schema(
                "update",
                [
                    "Update the content of an existing memory fact by fact_id.",
                    "Visibility and author are unchanged.",
                    "Returns the updated fact.",
                ].join("\n"),
                update_schema,
            )],
            ["ask", tool_from_schema(
                "ask",
                [
                    "Ask memory a question and get an answer based on relevant remembered facts.",
                    "question must be self-contained: the sub-agent has no dialog context.",
                    "Prefer this over search + get for normal Q&A.",
                ].join("\n"),
                ask_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        try {
            if (name === "remember") {
                const parsed = parse_tool_parameters(remember_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const author_user_id = this.resolve_author_user_id(parsed.value.author_user_id);
                if (!author_user_id.ok) {
                    return author_user_id.wrap_error("failed to resolve author user id");
                }

                const created = await this.memory.remember({
                    author_user_id: author_user_id.value,
                    content: parsed.value.content,
                    visibility: this.default_visibility,
                });
                if (!created.ok) {
                    return Expected.err(created.error);
                }
                return Expected.ok(JSON.stringify({ fact_id: created.value.id }));
            }

            if (name === "search") {
                const parsed = parse_tool_parameters(search_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const ids = await this.memory.search(parsed.value.content, this.access);
                if (!ids.ok) {
                    return Expected.err(ids.error);
                }
                return Expected.ok(JSON.stringify({ fact_ids: ids.value }));
            }

            if (name === "get") {
                const parsed = parse_tool_parameters(get_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const fact = await this.memory.get(parsed.value.fact_id, this.access);
                if (!fact.ok) {
                    return Expected.err(fact.error);
                }
                return Expected.ok(JSON.stringify({ fact: this.serialize_fact(fact.value) }));
            }

            if (name === "update") {
                const parsed = parse_tool_parameters(update_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const updated = await this.memory.update(
                    parsed.value.fact_id,
                    parsed.value.content,
                    this.access,
                );
                if (!updated.ok) {
                    return Expected.err(updated.error);
                }
                return Expected.ok(JSON.stringify({ fact: this.serialize_fact(updated.value) }));
            }

            if (name === "ask") {
                const parsed = parse_tool_parameters(ask_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }

                const answer = await this.memory.ask(parsed.value.question, this.access);
                if (!answer.ok) {
                    return Expected.err(answer.error);
                }
                return Expected.ok(JSON.stringify({ answer: answer.value }));
            }

            return Expected.err(`Unknown tool: ${name}`);
        } catch (e) {
            return Expected.exception(`simple_memory tool '${name}' failed`, e);
        }
    }

    // Prefer access.user_id (private chat). Otherwise require agent-provided user_id and resolve it.
    private resolve_author_user_id(
        agent_author_user_id: string | undefined,
    ): Expected<string> {
        if (this.access.user_id) {
            return Expected.ok(this.access.user_id);
        }

        if (!agent_author_user_id) {
            return Expected.err(
                "author_user_id is required. Pass the Telegram username of the requester.",
            );
        }

        const resolved = this.users.resolve_user({
            telegram_id: agent_author_user_id,
        });
        if (!resolved.ok || !resolved.value) {
            return Expected.err(
                `User '${agent_author_user_id}' not found. `
                + "You must pass a valid Telegram user_id (username without @) as author_user_id.",
            );
        }

        return Expected.ok(user_tgid(resolved.value));
    }

    private serialize_fact(fact: MemoryFact): SerializableMemoryFact {
        const resolved = this.users.resolve_user({
            telegram_id: fact.author_user_id,
        });
        const author = resolved.ok && resolved.value
            ? user_tgid(resolved.value)
            : fact.author_user_id;
        return {
            fact_id: fact.id,
            created_at: fact.created_at.toISOString(),
            author: `@${author}`,
            content: fact.content,
        };
    }
}
