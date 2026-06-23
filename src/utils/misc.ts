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
