import { OpenaiAPI, OpenaiModel } from "@src/api/openai.js";
import { Expected } from "@src/utils/expected.js";
import { ILLM, Message as LLMMessage } from "@src/interfaces/llm.js";

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
    model: OpenaiModel = "o3",
    llm: ILLM = OpenaiAPI.get_llm(model))
: Promise<Expected<string>>
{
    if (!OpenaiAPI.is_available()) {
        return Expected.err("OpenAI API is not available");
    }

    const messages: LLMMessage[] = [
        { role: "system", content: system_message },
    ];

    // Add conversation messages
    conversation.forEach((c) => {
        messages.push({ role: "user", content: `[${c.author}]\n${c.content}` });
    });

    // Add question
    messages.push({ role: "user", content: `[requester]\n${question}` });

    try {
        const response = await llm.generate_response(messages);
        if (!response.ok) {
            return Expected.err(response.error);
        }
        const response_content = response.value.content;
        if (!response_content || response_content.length === 0) {
            return Expected.err("Got empty response from the model");
        }
        return Expected.ok(response_content);
    } catch (err) {
        return Expected.exception("got an exception", err);
    }
}