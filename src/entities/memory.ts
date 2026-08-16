// Well-known group id for the managers chat / managers' shared memory scope.
// Used as `MemoryVisibility.group_id` when kind is `specific_group`.
export const MANAGERS_MEMORY_GROUP_ID = "managers";

// Who can access a memory fact.
// - `specific_user` — only the given user (UserData.id.system_id; private chorister chat).
// - `specific_group` — members of the given group (e.g. managers); also visible
//   in that group's chat and in private chats of group members.
// - `global` — everyone; must be requested explicitly (never the default).
export type MemoryVisibility =
    | { kind: "specific_user"; user_id: string }
    | { kind: "specific_group"; group_id: string }
    | { kind: "global" };

// Caller identity and scopes used to enforce visibility on read/forget/ask.
// If neither user nor groups are set, only global facts are visible.
// If a user is set (UserData.id.system_id), facts available to that user are visible as well.
// If groups are set, facts available in those groups are visible as well.
export type MemoryAccessContext = {
    user_id?: string;
    group_ids: string[];
};

export type MemoryFact = {
    // Internal id in format `DDMM_HHMM_XXXX`.
    id: string;
    created_at: Date;
    // Canonical UserData.id.system_id of who asked to remember the fact.
    author_user_id: string;
    // Fact text stored in memory.
    content: string;
    visibility: MemoryVisibility;
};

export type NewMemoryFact = Omit<MemoryFact, "id" | "created_at">;
