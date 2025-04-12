import { Feedback } from "@src/entities/feedback";
import { IGroupChat } from "@src/interfaces/group_chat.js";
import { IUserAgent } from "@src/interfaces/user_agent.js";
import { Status, StatusWith } from "@src/status.js";

// NOTE: not all addapters are required to support group chats
export interface IAdapter {

    init(): Promise<Status>;

    get_user_agent(user_id: string): Promise<StatusWith<IUserAgent>>;

    get_announcement_chat(): Promise<IGroupChat | undefined>;

    get_choir_chat(): Promise<IGroupChat | undefined>;

    get_managers_chat(): Promise<IManagersChat | undefined>;
}

export interface IManagersChat {
    on_new_feedback(feedback: Feedback): Promise<Status>;
}
