import { Language } from "@src/database.js";

export interface IMessagesProvider {

    get_attendance_notification_message(lang: Language, params: {
        chorister_name: string,
        skipped_rehersals: number,
        attendance_stat: string,
    }): string;

    get_attendance_reminders_report_message(lang: Language, params: {
        has_choristers: boolean,
        choristers_list: string,
        has_bad_attendance: boolean,
        bad_attendance: string,
    }): string;

}