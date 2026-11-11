import { LocalBroadcaster } from "@src/adapters/local_message_queue/local_broadcaster.js";
import { MemoryMessagesBacklog } from "@src/adapters/messages_storage/memory.js";
import { ManagersAgent } from "@src/components/ai/agents/managers_agent.js";
import { MemoryJournal } from "@src/components/memory_journal.js";
import { ManagersChatAgentConfig } from "@src/config.js";
import { TaskTrackerEvent } from "@src/interfaces/task_tracker_service.js";

import { mock_user_replica } from "./user_replica.js";

export function mock_managers_agent(overrides: Partial<ManagersAgent> = {}): ManagersAgent {
    const agent = new ManagersAgent(new ManagersChatAgentConfig({
        model: "gpt-6.1-sol", context_days: 3, prompt_file: "config/managers_chat_agent_prompt.txt",
    }), new MemoryMessagesBacklog(), new LocalBroadcaster<TaskTrackerEvent>(),
    { bot_id: "test_bot", get_managers_chat: async () => undefined },
    undefined, undefined, mock_user_replica(), new MemoryJournal());
    return Object.assign(agent, overrides);
}
