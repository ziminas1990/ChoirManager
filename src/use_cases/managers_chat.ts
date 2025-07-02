import { Status, StatusWith } from "@src/status.js";
import { Runtime } from "@src/runtime.js";
import { Message } from "@src/interfaces/messages_backlog";
import { answer_question } from "@src/ai_assistants/conversation_analyzer";


export class ManagersChat {

    public static async on_new_message(message: Message): Promise<Status> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat_backlog();
        if (!managers_chat) {
            return Status.fail("Managers chat backlog is not configured");
        }

        const status = await managers_chat.add_message(message);
        if (!status.ok()) {
            return status.wrap("Failed to add message to managers chat backlog");
        }

        console.log(`Message added to managers chat backlog: ${JSON.stringify(message)}`);

        return Status.ok();
    }

    public static async answer_question(request: string): Promise<StatusWith<string>> {
        const runtime = Runtime.get_instance();

        const managers_chat = runtime.get_managers_chat_backlog();
        if (!managers_chat) {
            return Status.fail("Managers chat backlog is not configured");
        }

        const now = new Date();
        const month_ago = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const conversation = await managers_chat.get_messages(month_ago, now);

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
                return {
                    author: e.sender,
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