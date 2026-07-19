import crypto from "crypto";

function pad_2(value: number): string {
    return value.toString().padStart(2, "0");
}

export function generate_task_id(created_at: Date): string {
    const date_part = [
        pad_2(created_at.getDate()),
        pad_2(created_at.getMonth() + 1),
        pad_2(created_at.getFullYear() % 100),
    ].join("");
    const suffix = crypto.randomBytes(2).toString("hex");
    return `${date_part}-${suffix}`;
}

// Format: DDMM_HHMM_XXXX
export function generate_memory_id(created_at: Date): string {
    const date_part = [
        pad_2(created_at.getDate()),
        pad_2(created_at.getMonth() + 1),
    ].join("");
    const time_part = [
        pad_2(created_at.getHours()),
        pad_2(created_at.getMinutes()),
    ].join("");
    const suffix = crypto.randomBytes(2).toString("hex");
    return `${date_part}_${time_part}_${suffix}`;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
