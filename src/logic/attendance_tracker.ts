import { Database, Language, Rehersal, Role, User } from "@src/database.js";
import { UserLogic } from "@src/logic/user.js";
import { Journal } from "@src/journal.js";
import { Logic } from "@src/logic/abstracts.js";
import { Expected, Status } from "@src/utils/expected.js";
import { IMessagesProvider } from "@src/interfaces/messages_provider.js";
import { IManagersChat } from "@src/interfaces/adapter.js";

export type AttendanceTrackerScheduleEntryJson = {
    day_of_week_utc: number;
    time_utc: string;
}

export type AttendanceTrackerConfigJson = {
    schedule_utc: AttendanceTrackerScheduleEntryJson[];
    skipped_rehersals_in_row: number;
}

type AttendanceTrackerScheduleEntry = {
    day_of_week_utc: number;
    hours: number;
    minutes: number;
}

function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
}

function utc_day_key(now: Date): string {
    return [
        now.getUTCFullYear(),
        pad_2(now.getUTCMonth() + 1),
        pad_2(now.getUTCDate()),
    ].join("-");
}

export class AttendanceTrackerConfig {
    constructor(private readonly json: AttendanceTrackerConfigJson) {}

    get skipped_rehersals_in_row(): number {
        return this.json.skipped_rehersals_in_row;
    }

    get schedule_utc(): AttendanceTrackerScheduleEntry[] {
        return (this.json.schedule_utc ?? []).map(entry => {
            const [hours, minutes] = entry.time_utc.split(":").map(part => parseInt(part, 10));
            return {
                day_of_week_utc: entry.day_of_week_utc,
                hours,
                minutes,
            };
        });
    }

    verify(): Status {
        if (!Number.isInteger(this.json.skipped_rehersals_in_row) || this.json.skipped_rehersals_in_row <= 0) {
            return Expected.err("'skipped_rehersals_in_row' MUST be a positive integer");
        }

        if (!Array.isArray(this.json.schedule_utc) || this.json.schedule_utc.length === 0) {
            return Expected.err("'schedule_utc' MUST contain at least one item");
        }

        for (const [index, entry] of this.json.schedule_utc.entries()) {
            const fail_prefix = `'schedule_utc[${index}]'`;
            if (!Number.isInteger(entry.day_of_week_utc) || entry.day_of_week_utc < 0 || entry.day_of_week_utc > 6) {
                return Expected.err(`${fail_prefix}.day_of_week_utc MUST be an integer between 0 and 6`);
            }
            if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(entry.time_utc)) {
                return Expected.err(`${fail_prefix}.time_utc MUST be in HH:MM format`);
            }
        }

        return Expected.ok(undefined);
    }
}

export class AttendanceTracker extends Logic<void> {
    private readonly journal: Journal;
    private readonly last_processed_schedule_day: Map<number, string> = new Map();
    private muted_until: Date;

    constructor(
        private readonly config: AttendanceTrackerConfig,
        private readonly messages_provider: IMessagesProvider,
        private readonly database: Database,
        private readonly get_user_logic: (tgid: string) => UserLogic | undefined,
        private readonly get_managers_chat: () => Promise<IManagersChat | undefined>,
        parent_journal: Journal,
    ) {
        super(30000);
        this.journal = parent_journal.child("attendance_tracker");
        this.muted_until = new Date(Date.now() + 30 * 60 * 1000);  // 30 minutes
    }

    async init(): Promise<Status> {
        this.journal.log().info("Initializing attendance tracker...");
        return Expected.ok(undefined);
    }

    protected async proceed_impl(now: Date, _interval_ms: number): Promise<Expected<void[]>> {
        for (const [index, schedule_entry] of this.config.schedule_utc.entries()) {
            if (!this.should_process_schedule_entry(index, schedule_entry, now)) {
                continue;
            }

            this.last_processed_schedule_day.set(index, utc_day_key(now));

            const notify_status = await this.notify_absent_choristers(now);
            if (!notify_status.ok) {
                return notify_status.wrap_error("failed to notify absent choristers");
            }
        }

        return Expected.ok([]);
    }

    private should_process_schedule_entry(
        schedule_entry_index: number,
        schedule_entry: AttendanceTrackerScheduleEntry,
        now: Date,
    ): boolean {
        if (now.getTime() < this.muted_until.getTime()) {
            return false;
        }

        if (this.last_processed_schedule_day.get(schedule_entry_index) === utc_day_key(now)) {
            return false;
        }

        if (now.getUTCDay() !== schedule_entry.day_of_week_utc) {
            return false;
        }

        const scheduled_second = schedule_entry.hours * 3600 + schedule_entry.minutes * 60;
        const now_second = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
        if (now_second < scheduled_second) {
            return false;
        }

        const seconds_since_scheduled = now_second - scheduled_second;
        // not more than 30 minutes since the scheduled time
        return seconds_since_scheduled < 30 * 60;
    }

    private async notify_absent_choristers(now: Date): Promise<Status> {
        const skipped_rehersals_in_row = this.config.skipped_rehersals_in_row;
        const choristers = this.get_choristers();
        const rehersals = this.get_rehersals()
            .filter(rehersal => rehersal.when().getTime() <= now.getTime())
            .sort((left, right) => right.when().getTime() - left.when().getTime());

        if (rehersals.length < skipped_rehersals_in_row) {
            return Expected.ok(undefined);
        }

        const notified_choristers: User[] = [];

        for (const chorister of choristers) {
            const last_skipped_rehersals = Helpers.last_skipped_rehersals(
                chorister.tgid, rehersals);
            if (last_skipped_rehersals.length !== skipped_rehersals_in_row) {
                continue;
            }

            const user_logic = this.get_user_logic(chorister.tgid);
            if (!user_logic) {
                continue;
            }

            const message = this.messages_provider.get_attendance_notification_message(
                chorister.lang,
                {
                    chorister_name: chorister.name,
                    skipped_rehersals: skipped_rehersals_in_row,
                }
            );
            for (const agent of user_logic.as_chorister()) {
                const sent = await agent.base().send_message(message);
                if (!sent.ok) {
                    this.journal.log().warn({
                        tgid: chorister.tgid,
                        error: sent.error,
                    }, "Failed to send attendance reminder");
                } else {
                    notified_choristers.push(chorister);
                    this.journal.log().info(
                        { tgid: chorister.tgid },
                        `Attendance reminder sent to ${chorister.name} (@${chorister.tgid})`);
                }
            }
        }

        if (notified_choristers.length > 0) {
            const report_status = await this.notify_managers_about_reminders(notified_choristers);
            if (!report_status.ok) {
                return report_status.wrap_error("failed to notify managers about attendance reminders");
            }
        }

        return Expected.ok(undefined);
    }

    private async notify_managers_about_reminders(choristers: User[]): Promise<Status> {
        const managers_chat = await this.get_managers_chat();
        if (!managers_chat) {
            this.journal.log().warn("Managers chat is not available for attendance reminders report");
            return Expected.ok(undefined);
        }

        const choristers_list = choristers
            .map(chorister => `${chorister.name} (@${chorister.tgid})`)
            .join("\n");
        const message = this.messages_provider.get_attendance_reminders_report_message(
            Language.RU,
            { choristers_list },
        );
        const sent = await managers_chat.send_message(message);
        if (!sent.ok) {
            this.journal.log().warn({ error: sent.error }, "Failed to send attendance reminders report");
            return sent.as_status();
        }

        this.journal.log().info(
            { choristers_count: choristers.length },
            "Attendance reminders report sent to managers chat",
        );
        return Expected.ok(undefined);
    }

    private get_choristers(): User[] {
        const choristers: User[] = [];
        for (const user of this.database.all_users()) {
            if (!user.is(Role.Chorister)) {
                continue;
            }
            choristers.push(user);
        }
        return choristers;
    }

    private get_rehersals(): Rehersal[] {
        return this.database.get_rehersals();
    }
}


class Helpers {
    // Returns rehersals skipped in a row after last known visited rehersal
    // Note: if user has not visited any rehersal yet, returns empty array.
    // It means that user has just joined the choir and don't need to be notified.
    static last_skipped_rehersals(tgid: string, rehersals: Rehersal[]): Rehersal[] {
        const skipped: Rehersal[] = [];
        for (const rehersal of rehersals) {
            if (rehersal.minutes_of_presence(tgid) <= 0) {
                skipped.push(rehersal);
            } else {
                return skipped;
            }
        }
        return [];
    }
}