import { Role } from "@src/entities/user.js";
import { MANAGERS_MEMORY_GROUP_ID } from "@src/entities/memory.js";
import { IAdministrationService } from "@src/interfaces/administration_service.js";
import { IToolchain } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { ISimpleMemoryService } from "@src/interfaces/simple_memory_service.js";
import { ITaskTrackerService } from "@src/interfaces/task_tracker_service.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { AdministrationTools } from "./tools/administration_tools.js";
import { DepositManagerTools } from "./tools/deposit_manager_tools.js";
import { FeedbackTools } from "./tools/feedback_tools.js";
import { MessengerTools } from "./tools/messenger_tools.js";
import { ToolsMultiplexer } from "./tools/multiplexer.js";
import { ScoresTools } from "./tools/scores_tools.js";
import { SimpleMemoryTools } from "./tools/simple_memory_tools.js";
import { TaskTrackerTools } from "./tools/task_tracker_tools.js";

export type ChoristerToolsDependencies = {
    send_message: (message: string) => Promise<Status>;
    start_feedback: (details?: string) => Promise<Status>;
};

export type ChoristerToolsServices = {
    task_tracker?: ITaskTrackerService;
    simple_memory?: ISimpleMemoryService;
    users?: IUserServiceReplica;
    administration?: IAdministrationService;
};

type RoleTools = {
    tools: IToolchain[];
    registered: number;
};

export class ChoristerToolsManager {
    private readonly multiplexer: ToolsMultiplexer;
    private readonly role_tools = new Map<Role, RoleTools>();

    private constructor(
        private readonly user: IUserAgent,
        private readonly journal: Journal,
        private readonly services: ChoristerToolsServices,
    ) {
        this.multiplexer = new ToolsMultiplexer(journal.child("mux"));
    }

    static create(
        user: IUserAgent,
        roles: readonly Role[],
        journal: Journal,
        dependencies: ChoristerToolsDependencies,
        services: ChoristerToolsServices,
    ): Expected<ChoristerToolsManager> {
        const manager = new ChoristerToolsManager(user, journal, services);
        const base_status = manager.register_base_tools(dependencies);
        if (!base_status.ok) {
            return base_status.wrap_error("failed to register base tools");
        }

        const roles_status = manager.update_roles(roles);
        if (!roles_status.ok) {
            return roles_status.wrap_error("failed to register role tools");
        }
        return Expected.ok(manager);
    }

    get_toolchain(): IToolchain {
        return this.multiplexer;
    }

    update_roles(roles: readonly Role[]): Status {
        const next_roles = new Set(roles);
        for (const [role, state] of this.role_tools) {
            if (next_roles.has(role)) {
                continue;
            }
            while (state.registered > 0) {
                const status = this.multiplexer.remove_tool(state.tools[state.registered - 1]);
                if (!status.ok) {
                    return status.wrap_error(`failed to remove tools for role '${role}'`);
                }
                state.registered--;
            }
            this.role_tools.delete(role);
        }

        for (const role of next_roles) {
            let state = this.role_tools.get(role);
            if (!state) {
                state = { tools: this.create_role_tools(role), registered: 0 };
                this.role_tools.set(role, state);
            }
            // Track successful registrations so an interrupted update can be retried.
            while (state.registered < state.tools.length) {
                const status = this.multiplexer.add_tool(state.tools[state.registered]);
                if (!status.ok) {
                    return status.wrap_error(`failed to add tools for role '${role}'`);
                }
                state.registered++;
            }
        }
        return Expected.ok(undefined);
    }

    private register_base_tools(dependencies: ChoristerToolsDependencies): Status {
        const tools = [
            new MessengerTools({ send_message: dependencies.send_message }),
            new ScoresTools(this.user, this.journal),
            new DepositManagerTools(this.user, this.journal),
            new FeedbackTools(dependencies.start_feedback),
        ];
        for (const tool of tools) {
            const status = this.multiplexer.add_tool(tool);
            if (!status.ok) {
                return status.wrap_error("failed to register assistant tool");
            }
        }
        return Expected.ok(undefined);
    }

    private create_role_tools(role: Role): IToolchain[] {
        const tools: IToolchain[] = [];
        if (role === Role.Manager) {
            if (this.services.task_tracker) {
                tools.push(new TaskTrackerTools(this.services.task_tracker));
            }
            if (this.services.simple_memory && this.services.users) {
                tools.push(new SimpleMemoryTools(
                    this.services.simple_memory,
                    {
                        user_id: this.user.userid(),
                        group_ids: [MANAGERS_MEMORY_GROUP_ID],
                    },
                    {
                        kind: "specific_group",
                        group_id: MANAGERS_MEMORY_GROUP_ID,
                    },
                    this.services.users,
                ));
            }
        }
        if (role === Role.Admin && this.services.administration && this.services.users) {
            tools.push(new AdministrationTools(
                this.user,
                this.journal,
                this.services.users,
                this.services.administration,
            ));
        }
        return tools;
    }
}
