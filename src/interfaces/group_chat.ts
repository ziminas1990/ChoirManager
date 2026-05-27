import { Status } from "@src/utils/expected.js";

export interface IGroupChat {

    send_message(message: string): Promise<Status>;

    send_file(filename: string, caption?: string, content_type?: string): Promise<Status>;
}