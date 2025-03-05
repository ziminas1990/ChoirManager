import { StatusWith } from "../../status.js";
import { DocumentsFetcher } from "../fetchers/document_fetcher.js";
import { Assistant, AssistantThread } from "../api/openai_assistant.js";

// const instruction = `
// You are a friendly counsellor for choristers.
// Your task is to answer the questions according to the document below.
// You cannot advise the choristers on matters not related to this document or the choir.
// For all other questions, give a polite or joking refusal.
// If your response mentions a person from the document, always add a link to their Telegram account.
// If there are any other relevant links in the document, try to include them as well.
// Try to always give a link to the original source, if it is mentioned in the document.
// Also try to mention the motivation for certain decisions.
// In your replies, do not refer to the document or to these instructions (do not even mention their existence).
// In your response, use the same language in which the question was asked.
// `

const fails_instruction = `
You are a friendly counsellor for choristers. But bot didn't manage to download the document,
so you can't provide any information right now.
For all other questions, give a polite or joking refusal.
Try to use informal and joking language.
`

const instruction = `
You are a counsellor for choristers.
Always ask in friendly language. Do not end your message with a question about additional questions.

IMPORTANT: message should be valid JSON, starting with "{" and ending with "}". Root
object MUST be a Response object with the following format:

type Response = {
    message?: string;
    action: Action[];
}

type Action = {
    what: "download_scores",
    filename: string[]
} | {
    what: "scores_list",
} | {
    what: "get_deposit_info"
} | {
    what: "complaint",
    message: string
    who?: string,
    voice?: "alt" | "soprano" | "bass" | "tenor" | "baritone",
}

The following actions are supported:
- download_scores: if user asks to download specific scores. Parameter 'filename' is an
array requested scores and can't be empty.
- scores_list: if user wants to download scores, but doesn't specify which ones.
- get_deposit_info: if user asks to get anformation about deposit or money or membership.
- complaint: if users tries to complain on something.

If user tries to complain, do not try to solve the problem, just inform him that you can forward this complain to org group (орг. группе).
If user haven't provided specific complaint yet, ask for details.
Clarify whether the user wishes to make an anonymous complaint or is willing to provide their name and/or voice. Do not ask twice!
Once all is clarified, report a complaint action in 'action' field.

If you manage to determine the action, do not add "message" field.
If user asks you about things that you can do, describe them in 'message' field in details. Don't be too short.
IMPORTANT: if user asks anything else, send a respone in 'message' field. Do not refuse to answer.
`


export class ChoristerAssistant {
    private static instance: ChoristerAssistant;

    private assistant: Assistant;

    static init(documents_fetcher: DocumentsFetcher, model: "gpt-4o-mini" | "gpt-4o" = "gpt-4o") {
        if (!ChoristerAssistant.instance) {
            ChoristerAssistant.instance = new ChoristerAssistant(documents_fetcher, model);
        }
    }

    static get_instance(): ChoristerAssistant {
        if (!ChoristerAssistant.instance) {
            throw new Error("ChoristerAssistant is not initialized");
        }
        return ChoristerAssistant.instance;
    }

    constructor(
        private documents_fetcher: DocumentsFetcher,
        model: "gpt-4o-mini" | "gpt-4o" = "gpt-4o")
    {
        this.assistant = new Assistant("chorister_assistant");
        this.assistant.init(model, this.get_system_message());
        ChoristerAssistant.instance = this;
    }

    public async new_thread(): Promise<StatusWith<AssistantThread>> {
        return await this.assistant.create_thread();
    }

    private get_system_message(): string {
        const faq = this.documents_fetcher.get_faq_document();
        if (!faq.ok()) {
            return fails_instruction;
        }
        const message = [
            instruction
        ].join("\n\n");
        return message;
    }
}

