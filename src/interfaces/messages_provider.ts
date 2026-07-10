import { Language } from "@src/database.js";

export interface IMessagesProvider {

    get_attendance_notification_message(lang: Language, params: {
        chorister_name: string,
        skipped_rehersals: number,
    }): string;

}