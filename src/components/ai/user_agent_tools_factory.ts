import { IToolchain } from "@src/interfaces/llm.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import { DepositManagerTools } from "./tools/deposit_manager_tools.js";
import { FeedbackTools } from "./tools/feedback_tools.js";
import { MessengerTools } from "./tools/messenger_tools.js";
import { ScoresTools } from "./tools/scores_tools.js";
import { ToolsMultiplexer } from "./tools/multiplexer.js";

export type UserAgentToolsDependencies = {
    send_message: (message: string) => Promise<Status>;
    start_feedback: (details?: string) => Promise<Status>;
};

export function build_user_assistant_tools(
    user_agent: IUserAgent,
    journal: Journal,
    dependencies: UserAgentToolsDependencies,
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
    const failed = statuses.find(status => !status.ok);
    if (failed) {
        return failed.wrap_error("failed to register assistant tool");
    }
    return Expected.ok(tools);
}
