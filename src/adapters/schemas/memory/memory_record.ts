import { MemoryVisibility } from "@src/entities/memory.js";

export type MemoryFactRecord =
    { schema: 1 } & MemoryFactRecord_v1;

type MemoryFactRecord_v1 = {
    id: string;
    created_at: Date;
    author_user_id: string;
    author_name: string;
    content: string;
    visibility: MemoryVisibility;
};
