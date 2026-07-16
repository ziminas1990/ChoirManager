import { Role, User } from "@src/database.js";
import { IToolchain } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { TaskTracker } from "@src/logic/task_tracker.js";
import { Expected, Status } from "@src/utils/expected.js";
import { DepositManagerTools } from "./tools/deposit_manager_tools.js";
import { FeedbackTools } from "./tools/feedback_tools.js";
import { MessengerTools } from "./tools/messenger_tools.js";
import { ScoresTools } from "./tools/scores_tools.js";
import { TaskTrackerTools } from "./tools/task_tracker_tools.js";
import { ToolsMultiplexer } from "./tools/multiplexer.js";

export type UserAgentToolsDependencies = {
    send_message: (message: string) => Promise<Status>;
    start_feedback: (details?: string) => Promise<Status>;
};

export function build_user_assistant_tools(
    user_agent: IUserAgent,
    user: User,
    journal: Journal,
    dependencies: UserAgentToolsDependencies,
    task_tracker?: TaskTracker,
): Expected<IToolchain>
{
    const tools = new ToolsMultiplexer(journal.child("tools"));
    const statuses = [
        tools.add_tool(new MessengerTools({
            send_message: dependencies.send_message,
        })),
        tools.add_tool(new ScoresTools(user_agent, journal)),
        tools.add_tool(new DepositManagerTools(user_agent, journal)),
        tools.add_tool(new FeedbackTools(dependencies.start_feedback)),
    ];

    if (user.is(Role.Manager) && task_tracker) {
        statuses.push(tools.add_tool(new TaskTrackerTools(
            (filter) => task_tracker.get_tasks(filter),
            (task) => task_tracker.create_task(task),
            (task) => task_tracker.update_task(task),
            (task) => task_tracker.delete_task(task),
        )));
    }

    const failed = statuses.find(status => !status.ok);
    if (failed) {
        return failed.wrap_error("failed to register assistant tool");
    }
    return Expected.ok(tools);
}
