import { Role, User } from "@src/database.js";
import { IToolchain } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { ITaskTracker } from "@src/interfaces/task_tracker.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { DepositManagerTools } from "./tools/deposit_manager_tools.js";
import { FeedbackTools } from "./tools/feedback_tools.js";
import { MessengerTools } from "./tools/messenger_tools.js";
import { ScoresTools } from "./tools/scores_tools.js";
import { TaskTrackerTools } from "./tools/task_tracker_tools.js";

export type UserAgentToolsDependencies = {
    send_message: (message: string) => Promise<Status>;
    start_feedback: (details?: string) => Promise<Status>;
};

export type Services = {
    task_tracker?: ITaskTracker;
}

type ToolsHost = {
    add_tool(toolchain: IToolchain): Status;
};

export function register_user_assistant_tools(
    host: ToolsHost,
    user_agent: IUserAgent,
    user: User,
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

    if (user.is(Role.Manager) && services.task_tracker) {
        statuses.push(host.add_tool(new TaskTrackerTools(services.task_tracker)));
    }

    const failed = statuses.find(status => !status.ok);
    if (failed) {
        return failed.wrap_error("failed to register assistant tool");
    }
    return Expected.ok(undefined);
}
