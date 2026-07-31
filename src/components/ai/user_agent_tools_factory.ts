import { Role, UserData, user_has_role, user_tgid } from "@src/entities/user.js";
import { MANAGERS_MEMORY_GROUP_ID } from "@src/entities/memory.js";
import { IToolchain } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { ISimpleMemoryService } from "@src/interfaces/simple_memory_service.js";
import { ITaskTrackerService } from "@src/interfaces/task_tracker_service.js";
import { IUserServiceReplica } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { DepositManagerTools } from "./tools/deposit_manager_tools.js";
import { FeedbackTools } from "./tools/feedback_tools.js";
import { MessengerTools } from "./tools/messenger_tools.js";
import { ScoresTools } from "./tools/scores_tools.js";
import { SimpleMemoryTools } from "./tools/simple_memory_tools.js";
import { TaskTrackerTools } from "./tools/task_tracker_tools.js";

export type UserAgentToolsDependencies = {
    send_message: (message: string) => Promise<Status>;
    start_feedback: (details?: string) => Promise<Status>;
};

export type Services = {
    task_tracker?: ITaskTrackerService;
    simple_memory?: ISimpleMemoryService;
    users?: IUserServiceReplica;
}

type ToolsHost = {
    add_tool(toolchain: IToolchain): Status;
};

export function register_user_assistant_tools(
    host: ToolsHost,
    user_agent: IUserAgent,
    user: UserData,
    journal: Journal,
    dependencies: UserAgentToolsDependencies,
    services: Services,
): Status
{
    const statuses = [
        host.add_tool(new MessengerTools({
            send_message: dependencies.send_message,
        })),
        host.add_tool(new ScoresTools(user_agent, journal)),
        host.add_tool(new DepositManagerTools(user_agent, journal)),
        host.add_tool(new FeedbackTools(dependencies.start_feedback)),
    ];

    if (user_has_role(user, Role.Manager) && services.task_tracker) {
        statuses.push(host.add_tool(new TaskTrackerTools(services.task_tracker)));
    }

    if (user_has_role(user, Role.Manager) && services.simple_memory && services.users) {
        statuses.push(host.add_tool(new SimpleMemoryTools(
            services.simple_memory,
            {
                user_id: user_tgid(user),
                group_ids: [MANAGERS_MEMORY_GROUP_ID],
            },
            {
                kind: "specific_group",
                group_id: MANAGERS_MEMORY_GROUP_ID,
            },
            services.users,
        )));
    }

    const failed = statuses.find(status => !status.ok);
    if (failed) {
        return failed.wrap_error("failed to register assistant tool");
    }
    return Expected.ok(undefined);
}
