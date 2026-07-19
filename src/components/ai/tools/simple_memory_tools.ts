import { z } from "zod";

import {
    MemoryAccessContext,
    MemoryFact,
    MemoryVisibility,
} from "@src/entities/memory.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { ISimpleMemoryService } from "@src/interfaces/simple_memory.js";
import { Expected } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";

const remember_schema = z.object({
    author: z.string().trim().min(1)
        .describe("Author of the message that initiated this call."),
    content: z.string().trim().min(1)
        .describe("Fact text to store in memory."),
}).strict();

const search_schema = z.object({
    content: z.string().trim().min(1)
        .describe("Search query used to find relevant memory fact ids."),
}).strict();

const get_schema = z.object({
    fact_id: z.string().trim().min(1)
        .describe("Fact id returned by search or remember."),
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
If the user asks something that is clearly not available in the current conversation context,
or explicitly asks to recall / look up a remembered answer:
- call ask with a self-contained question
- the memory sub-agent has NO dialog context, so question must include every detail needed
  to understand and answer (names, dates, what was meant, constraints)
- send a message with the answer from the tool result

If the user explicitly asks to remember a new fact:
- call remember only when the user clearly requested remembering (do not infer)
- pass the author of the message that initiated the call
- pass content as the fact text
- after success, send a short confirmation that the fact was remembered

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

function serialize_fact(fact: MemoryFact): SerializableMemoryFact {
    return {
        fact_id: fact.id,
        created_at: fact.created_at.toISOString(),
        author: fact.author_name,
        content: fact.content,
    };
}

export class SimpleMemoryTools implements IToolchain {
    constructor(
        private readonly memory: ISimpleMemoryService,
        private readonly access: MemoryAccessContext,
        private readonly default_visibility: MemoryVisibility,
    ) {}

    get_name(): string {
        return "simple_memory";
    }

    get_readme(): string {
        return [
            "Tools for storing and consulting durable memory facts.",
            "Use ask when the user needs an answer based on remembered facts.",
            "Use remember when you need to remember some fact for future use.",
            "Use search + get when you need to find matching fact records.",
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

                const created = await this.memory.remember({
                    author_user_id: this.access.user_id ?? "",
                    author_name: parsed.value.author,
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
                return Expected.ok(JSON.stringify({ fact: serialize_fact(fact.value) }));
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
}
