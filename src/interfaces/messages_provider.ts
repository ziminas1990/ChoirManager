import { Language } from "@src/database.js";

export interface IMessagesProvider {

    get_attendance_notification_message(lang: Language, params: {
        chorister_name: string,
        skipped_rehersals: number,
    }): string;

    get_attendance_reminders_report_message(lang: Language, params: {
        choristers_list: string,
    }): string;

}