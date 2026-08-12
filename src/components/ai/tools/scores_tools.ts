import { z } from "zod";

import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { ScoresActions } from "@src/use_cases/scores_actions.js";
import { Expected } from "@src/utils/expected.js";
import { empty_parameters_schema, parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_error, return_success, status_to_expected } from "./tool_response.js";

const scores_search_schema = z.object({
    query: z.string().trim().min(1)
        .describe("Search query: score title, author, or alias."),
}).strict();

const scores_send_to_user_schema = z.object({
    query: z.string().trim().min(1).describe("Selected score title or filename."),
}).strict();

const SCORES_USE_CASES = `
If user asks for scores without a specific title:
- just call scores_display_list

If user asks for a specific score by title or author, do the following:
- immediately send a message that says that you are looking for the score
- call scores_search with the user's query
- if one match: call scores_send_to_user with that score's title
- if several matches: ask the user which one, then call scores_send_to_user
- if none: tell the user nothing was found (optionally offer scores_display_list)
`.trim();

export class ScoresTools implements IToolchain {
    constructor(
        private user: IUserAgent,
        private journal: Journal,
    ) {}

    get_name(): string {
        return "scores";
    }

    get_readme(): string {
        return [
            "Tools for choir scores.",
            "Use scores_display_list to display a scores list to the user",
            "Use scores_search to find matching scores by title, author, or alias.",
            "Use scores_get_list when you need the full machine-readable catalog.",
            "Use scores_send_to_user after you selected the exact score.",
        ].join("\n");
    }

    get_use_cases(): string {
        return SCORES_USE_CASES;
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["scores_display_list", tool_from_schema(
                "scores_display_list",
                "Send the user a browsable list of available scores with download buttons.",
                empty_parameters_schema,
            )],
            ["scores_search", tool_from_schema(
                "scores_search",
                "Search the scores catalog by title, author, or alias. Returns matching scores.",
                scores_search_schema,
            )],
            ["scores_get_list", tool_from_schema(
                "scores_get_list",
                "Return the full machine-readable list of downloadable scores. Does not send a message to the user.",
                empty_parameters_schema,
            )],
            ["scores_send_to_user", tool_from_schema(
                "scores_send_to_user",
                [
                    "Send the user a link to a specific score.",
                    "Use after you selected the exact score from scores_search or scores_get_list.",
                    "Pass the selected score title or filename.",
                ].join("\n"),
                scores_send_to_user_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        if (name === "scores_display_list") {
            const parsed = parse_tool_parameters(empty_parameters_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await ScoresActions.scores_list_requested(this.user, this.journal);
            return status_to_expected(status, return_success(true));
        }

        if (name === "scores_search") {
            const parsed = parse_tool_parameters(scores_search_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const searched = await ScoresActions.search_scores(
                this.user,
                parsed.value.query,
                this.journal,
            );
            if (!searched.ok) {
                return searched.cast_error<string>();
            }
            return Expected.ok(return_success(searched.value));
        }

        if (name === "scores_get_list") {
            const parsed = parse_tool_parameters(empty_parameters_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const scores = await ScoresActions.get_available_scores(this.user, this.journal);
            return Array.isArray(scores)
                ? Expected.ok(return_success(scores))
                : scores.cast_error<string>();
        }

        if (name === "scores_send_to_user") {
            const parsed = parse_tool_parameters(scores_send_to_user_schema, parameters);
            if (!parsed.ok) {
                return Expected.err(return_error(parsed.error));
            }
            const status = await ScoresActions.download_scores_request(
                this.user,
                parsed.value.query,
                this.journal,
            );
            return status_to_expected(status, return_success(true));
        }

        return Expected.err(return_error(`Unknown tool: ${name}`));
    }
}
