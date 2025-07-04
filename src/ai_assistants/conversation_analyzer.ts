import { OpenaiAPI } from "@src/api/openai";
import { Status, StatusWith } from "@src/status";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const system_message = `
Your are a helpful assistant, that reads the conversation and may answer questions about it or provide summary of the conversation.
You will be provided with a conversation, which is an array of messages. You should answer the question based on the conversation.
The question will be provided after the conversation as a user message with name "requester".
Note that your message will be passed to telegram API "as-is".

If user asks to build a summary, follow these rules:
1. if user specifies a period, use only messages from this period
2. determins all points, that were discussed in the conversation
3. in your answer each point should be presented as a separate paragraph
`;

export type Message = {
    author: string,
    content: string,
}

// Provide an answer for the specified 'question' based on the provided 'context'.
// Additional details about the context should be provided in the 'context_description'.
// It can describe context format or other details that are important for the answer.
// Use a model, specified by the 'model' parameter.
export async function answer_question(
    conversation: Message[],
    question: string,
    model: "gpt-4o-mini" | "gpt-4o" | "o3" = "o3")
: Promise<StatusWith<string>>
{
    if (!OpenaiAPI.is_available()) {
        return Status.fail("OpenAI API is not available");
    }

    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: system_message },
    ];

    // Add conversation messages
    conversation.forEach((c) => {
        messages.push({ role: "user", content: c.content, name: c.author });
    });

    // Add question
    messages.push({ role: "user", content: question, name: "requester" });

    try {
        const openai = OpenaiAPI.get_instance();
        const response = await openai.chat.completions.create({ model, messages });
        if (response.choices.length === 0) {
            return Status.fail("No response from the model");
        }
        const response_content = response.choices[0].message.content;
        if (!response_content || response_content.length === 0) {
            return Status.fail("Got empty response from the model");
        }
        return Status.ok().with(response_content);
    } catch (err) {
        return Status.exception(err).wrap("got an exception");
    }
}