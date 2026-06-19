import { Feedback } from "@src/entities/feedback.js";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Expected, Status } from "@src/utils/expected.js";

// NOTE: not all addapters are required to support group chats
export interface IAdapter {

    init(): Promise<Status>;

    get_user_agent(user_id: string): Promise<Expected<IUserAgent>>;

    get_announcement_chat(): Promise<IGroupChat | undefined>;

    get_choir_chat(): Promise<IGroupChat | undefined>;

    get_managers_chat(): Promise<IManagersChat | undefined>;
}

export type TableRecord = {
    table_name: string;
    fields: {
        name: string;
        value: string;
    }[];
}

export interface IManagersChat {
    send_message(message: string): Promise<Expected<string>>;

    send_typing_action(): Promise<Status>;

    on_new_feedback(feedback: Feedback): Promise<Status>;

    on_new_table_record(record: TableRecord): Promise<Status>;
}
