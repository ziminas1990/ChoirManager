import { Expected, Status } from "@src/utils/expected.js";

export interface IGroupChat {

    // Rich HTML; use <br> or block tags for visible line breaks.
    send_message(message: string): Promise<Expected<string>>;

    send_typing_action(): Promise<Status>;

    send_file(filename: string, caption?: string, content_type?: string): Promise<Status>;
}
