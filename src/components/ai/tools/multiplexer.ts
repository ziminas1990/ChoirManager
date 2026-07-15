import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";

const LOG_RESULT_MAX_LEN = 500;

function truncate_for_log(text: string, max_len = LOG_RESULT_MAX_LEN): string {
    if (text.length <= max_len) {
        return text;
    }
    return `${text.slice(0, max_len)}... (${text.length} chars total)`;
}

function validate_tool_name(name: string): Status {
    if (name.match(/^[a-zA-Z0-9_]+$/) === null) {
        return Expected.err(`Tool name '${name}' contains invalid characters`);
    }
    if (name.includes("__")) {
        return Expected.err(`Tool name '${name}' contains double underscore`);
    }
    return Expected.ok(undefined);
}

export class ToolsMultiplexer implements IToolchain {
    private name2toolchain: Map<string, IToolchain> = new Map();
    private function2toolchain: Map<string, IToolchain> = new Map();

    private get_tools_cache?: Map<string, Tool>;

    constructor(private journal: Journal) {}

    add_tool(toolchain: IToolchain): Status {
        const status = validate_tool_name(toolchain.get_name());
        if (!status.ok) {
            return status.wrap_error("Invalid tool name");
        }

        if (this.name2toolchain.has(toolchain.get_name())) {
            return Expected.err(`Toolchain '${toolchain.get_name()}' already registered`);
        }

        const tools = Array.from(toolchain.get_tools().values());
        for (const tool of tools) {
            if (this.function2toolchain.has(tool.name)) {
                return Expected.err(`Function '${tool.name}' already registered`);
            }
        }

        this.name2toolchain.set(toolchain.get_name(), toolchain);
        for (const tool of tools) {
            this.function2toolchain.set(tool.name, toolchain);
        }
        this.get_tools_cache = undefined;
        return Expected.ok(undefined);
    }

    get_name(): string {
        return "Tools_Multiplexer";
    }

    get_readme(): string {
        const all = Array.from(this.name2toolchain.values())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        const readme = [
            `Available toolchains: ${all.map(toolchain => toolchain.get_name()).join(", ")}`,
        ];

        all.forEach((toolchain) => {
            readme.push(`\n## ${toolchain.get_name()}`);
            readme.push(toolchain.get_readme());
        });

        return readme.join("\n");
    }

    get_use_cases(): string {
        const all = Array.from(this.name2toolchain.values())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        const use_cases = all
            .map((toolchain) => ({
                name: toolchain.get_name(),
                content: toolchain.get_use_cases().trim(),
            }))
            .filter((item) => item.content !== "");

        if (use_cases.length === 0) {
            return "";
        }

        const lines = [
            "## Use cases",
            "",
            "Use cases provide a precise and clear set of instructions for the assistant and assistant MUST follow them strictly.",
            "",
            "IMPORTANT RULES:",
            "- If the use case does not explicitly say to send a message, do NOT send a custom message.",
            "- Do NOT add any extra steps that are not written in that use case.",
            "- Do NOT send acknowledgements, progress updates, introductions, or summaries when the required tool already handles the user-facing response.",
        ];

        for (const item of use_cases) {
            lines.push("", `### ${item.name}`, "", item.content);
        }

        return lines.join("\n");
    }

    get_tools(): Map<string, Tool> {
        if (this.get_tools_cache !== undefined) {
            return this.get_tools_cache;
        }

        const all = Array.from(this.name2toolchain.values());
        this.get_tools_cache = new Map<string, Tool>();
        for (const toolchain of all) {
            toolchain.get_tools().forEach((tool) => {
                this.get_tools_cache!.set(tool.name, tool);
            });
        }
        return this.get_tools_cache;
    }

    async call_tool(name: string, parameters: Record<string, unknown>)
    : Promise<Expected<string>>
    {
        const toolchain = this.function2toolchain.get(name);
        if (toolchain === undefined) {
            this.journal.log().error({ tool: name, parameters }, `tool '${name}' not found`);
            return Expected.err(`Function '${name}' not found`);
        }

        const started_at = Date.now();
        this.journal.log().info(
            { tool: name, toolchain: toolchain.get_name(), parameters },
            `calling tool '${name}'`,
        );

        const result = await toolchain.call_tool(name, parameters);
        const duration_ms = Date.now() - started_at;

        if (result.ok) {
            this.journal.log().info(
                {
                    tool: name,
                    toolchain: toolchain.get_name(),
                    duration_ms,
                    result: truncate_for_log(result.value),
                },
                `tool '${name}' completed in ${duration_ms}ms`,
            );
        } else {
            this.journal.log().error(
                {
                    tool: name,
                    toolchain: toolchain.get_name(),
                    duration_ms,
                    error: result.error,
                },
                `tool '${name}' failed in ${duration_ms}ms`,
            );
        }

        return result;
    }
}
