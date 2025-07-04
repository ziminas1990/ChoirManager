import { Status, StatusWith } from "@src/status.js";
import { Runtime } from "@src/runtime.js";
import { answer_question } from "@src/ai_assistants/conversation_analyzer";
import { GroupChatMessage } from "@src/logic/group_chat";
import { IUserAgent } from "@src/interfaces/user_agent";

export class ManagersChat {

    public static async on_new_message(user: IUserAgent, message: GroupChatMessage): Promise<Status> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat();
        if (!managers_chat) {
            return Status.fail("Managers chat is not configured");
        }

        managers_chat.on_new_message(user, message);
        return Status.ok();
    }

    public static async answer_question(request: string): Promise<StatusWith<string>> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat();
        if (!managers_chat) {
            return Status.fail("Managers chat is not configured");
        }

        const now = new Date();
        const month_ago = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        const conversation = await managers_chat.fetch_messages(month_ago, now);

        if (!conversation.ok() || !conversation.value) {
            return conversation.wrap("Failed to get conversation");
        }
        if (conversation.value.length === 0) {
            return Status.fail("No conversation data");
        }

        const answer = await answer_question(
            conversation.value
            .sort((a, b) => a.time.getTime() - b.time.getTime())
            .map(e => {
                const user = runtime.get_user(e.user_id);
                return {
                    author: user?.data.name ?? e.user_id,
                    content: `Sent at [${e.time.toLocaleString()}]\n${e.text}`,
                }
            }),
            request,
            "gpt-4o"
        );
        if (!answer.ok()) {
            return answer.wrap("request to AI failed");
        }
        return answer;
    }
}