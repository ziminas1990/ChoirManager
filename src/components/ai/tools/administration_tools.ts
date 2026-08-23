import { z } from "zod";

import { Language, Role, UserData, UserFields, Voice } from "@src/entities/user.js";
import { IAdministrationService } from "@src/interfaces/administration_service.js";
import { IToolchain, Tool } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { IUserServiceReplica, UserFindQuery } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { AdministratorWorkflows } from "@src/use_cases/administrator_workflows.js";
import { Expected } from "@src/utils/expected.js";
import { parse_tool_parameters, tool_from_schema } from "./tool_schema.js";
import { return_success } from "./tool_response.js";

const ROLE_VALUES = [
    Role.Chorister,
    Role.Conductor,
    Role.Manager,
    Role.Admin,
    Role.Accountant,
    Role.ExChorister,
] as const;

const LANGUAGE_VALUES = [Language.RU, Language.EN] as const;

const VOICE_VALUES = [
    Voice.Alto,
    Voice.Soprano,
    Voice.Tenor,
    Voice.Baritone,
    Voice.Unknown,
] as const;

const FIND_USERS_LIMIT = 50;

const role_schema = z.enum(ROLE_VALUES);
const language_schema = z.enum(LANGUAGE_VALUES);
const voice_schema = z.enum(VOICE_VALUES);

const users_find_schema = z.object({
    query: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional substring match on name, surname, telegram username, or system_id."),
    system_id: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact system_id."),
    tg_username: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional telegram username, with or without @."),
    role: role_schema
        .optional()
        .describe("Optional role that the user must have."),
}).strict();

const user_create_request_schema = z.object({
    name: z.string().trim().min(1).describe("Given name."),
    surname: z.string().trim().min(1).describe("Family name."),
    lang: language_schema.optional().describe("Preferred language. Defaults to en."),
    voice: voice_schema.optional().describe("Choir voice. Defaults to unknown."),
    tg_username: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Telegram username without requiring @."),
    roles: z.array(role_schema)
        .optional()
        .describe("Roles to assign on create. Defaults to none."),
}).strict();

const user_update_request_schema = z.object({
    system_id: z.string()
        .trim()
        .min(1)
        .describe("Target system_id returned by users_find. Do not invent it."),
    name: z.string().trim().min(1).optional().describe("New given name."),
    surname: z.string().trim().min(1).optional().describe("New family name."),
    lang: language_schema.optional().describe("New preferred language."),
    voice: voice_schema.optional().describe("New choir voice."),
    tg_username: z.string()
        .trim()
        .min(1)
        .optional()
        .describe("Telegram username to bind if the user has none yet."),
    add_roles: z.array(role_schema)
        .optional()
        .describe("Roles to add."),
    remove_roles: z.array(role_schema)
        .optional()
        .describe("Roles to remove."),
}).strict();

const ADMINISTRATION_USE_CASES = `
If user asks to find, list, or identify a user:
- call users_find with a query, telegram username, role, or system_id
- never invent system_id; only use system_id values returned by users_find
- never show system_id to the user unless they explicitly asked for it

If user asks to create a user:
- call user_create_request with the known fields
- after that, do nothing until the next user request; the system handles all further communication

If user asks to change a user's profile or roles:
- call users_find first unless system_id is already known from an earlier users_find in this conversation
- if more than one user matches, ask a clarifying question instead of guessing
- once identified, call user_update_request with that system_id and only the fields or roles that should change
- after user_update_request, do nothing until the next user request; the system handles all further communication

If any administration tool call fails:
- send a short message that the request could not be completed and include the error reason
`.trim();

export class AdministrationTools implements IToolchain {
    private readonly journal: Journal;

    constructor(
        private readonly agent: IUserAgent,
        journal: Journal,
        private readonly users: IUserServiceReplica,
        private readonly admin_svc: IAdministrationService,
    ) {
        this.journal = journal.child("administration_tools");
    }

    get_name(): string {
        return "administration";
    }

    get_readme(): string {
        return [
            "Tools for looking up users and requesting create/update operations.",
            "users_find is read-only and returns system_id for later mutations.",
            "user_create_request and user_update_request start a confirmation workflow.",
            "Never invent system_id; take it only from users_find.",
        ].join("\n");
    }

    get_use_cases(): string {
        return ADMINISTRATION_USE_CASES;
    }

    get_tools(): Map<string, Tool> {
        return new Map([
            ["users_find", tool_from_schema(
                "users_find",
                [
                    "Find users by query, telegram username, role, or system_id.",
                    "Returns a JSON object with a 'users' array.",
                    "Each user includes system_id for user_update_request.",
                ].join("\n"),
                users_find_schema,
            )],
            ["user_create_request", tool_from_schema(
                "user_create_request",
                [
                    "Request creating a user. Sends confirmation buttons to the admin.",
                ].join("\n"),
                user_create_request_schema,
            )],
            ["user_update_request", tool_from_schema(
                "user_update_request",
                [
                    "Request updating a user identified by system_id from users_find.",
                    "Pass only fields and roles that should change.",
                    "Sends confirmation buttons to the admin.",
                ].join("\n"),
                user_update_request_schema,
            )],
        ]);
    }

    async call_tool(name: string, parameters: Record<string, unknown>): Promise<Expected<string>> {
        try {
            if (name === "users_find") {
                const parsed = parse_tool_parameters(users_find_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }
                return this.find_users(parsed.value);
            }

            if (name === "user_create_request") {
                const parsed = parse_tool_parameters(user_create_request_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }
                void AdministratorWorkflows.create_user(
                    { agent: this.agent, admin_svc: this.admin_svc },
                    Helpers.to_user_fields(parsed.value),
                    parsed.value.roles ?? [],
                    this.journal,
                ).catch((error) => {
                    this.journal.log().error(error, "create_user workflow crashed");
                });
                return Expected.ok(return_success(true));
            }

            if (name === "user_update_request") {
                const parsed = parse_tool_parameters(user_update_request_schema, parameters);
                if (!parsed.ok) {
                    return Expected.err(parsed.error);
                }
                void AdministratorWorkflows.update_user(
                    { agent: this.agent, admin_svc: this.admin_svc },
                    parsed.value.system_id,
                    Helpers.to_user_fields(parsed.value),
                    parsed.value.add_roles ?? [],
                    parsed.value.remove_roles ?? [],
                    this.journal,
                ).catch((error) => {
                    this.journal.log().error(error, "update_user workflow crashed");
                });
                return Expected.ok(return_success(true));
            }

            return Expected.err(`Unknown tool: ${name}`);
        } catch (error) {
            return Expected.exception(`administration tool '${name}' failed`, error);
        }
    }

    private find_users(query: UserFindQuery): Expected<string> {
        const matched = this.users.find(query);
        if (matched.length > FIND_USERS_LIMIT) {
            return Expected.err(
                `too many users match the query (${matched.length} > ${FIND_USERS_LIMIT}); `
                + "narrow the query",
            );
        }
        return Expected.ok(JSON.stringify({
            users: matched.map(Helpers.serialize_user),
        }));
    }
}

class Helpers {

    static to_user_fields(parameters: {
        name?: string;
        surname?: string;
        lang?: Language;
        voice?: Voice;
        tg_username?: string;
    }): UserFields {
        return {
            name: parameters.name,
            surname: parameters.surname,
            lang: parameters.lang,
            voice: parameters.voice,
            tg_username: Helpers.normalize_username(parameters.tg_username),
        };
    }

    static normalize_username(value: string | undefined): string | undefined {
        if (value == undefined) {
            return undefined;
        }
        return value.replace(/^@/, "");
    }

    static serialize_user(user: UserData) {
        return {
            system_id: user.id.system_id,
            tg_username: user.id.tg_username,
            name: user.name,
            surname: user.surname,
            lang: user.lang,
            voice: user.voice,
            roles: [...user.roles],
        };
    }
}
