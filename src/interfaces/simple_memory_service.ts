import {
    MemoryAccessContext,
    MemoryFact,
    NewMemoryFact,
} from "@src/entities/memory.js";
import { Expected, Status } from "@src/utils/expected.js";

// Service logic: access control, caching, and higher-level operations.
export interface ISimpleMemoryService {
    init(): Promise<Status>;

    // Store a new fact. Assigns `id` and `created_at`.
    // Callers must set visibility; `global` is allowed only when the user
    // explicitly requested it (enforced by the toolchain / agent prompt).
    remember(fact: NewMemoryFact): Promise<Expected<MemoryFact>>;

    // Remove a fact by id if the caller may access it.
    // Returns the removed fact, or an error if missing / not visible.
    forget(id: string, access: MemoryAccessContext): Promise<Expected<MemoryFact>>;

    // Update the content of a fact if the caller may access it.
    // Visibility and author are unchanged.
    // Returns the updated fact, or an error if missing / not visible.
    update(id: string, content: string, access: MemoryAccessContext): Promise<Expected<MemoryFact>>;

    // List facts visible to the caller under `access`.
    list(access: MemoryAccessContext): Promise<Expected<MemoryFact[]>>;

    // Get a single fact by id if visible to the caller.
    get(id: string, access: MemoryAccessContext): Promise<Expected<MemoryFact>>;

    // Run a memory search query.
    // Only facts visible under `access` are considered.
    // Returns matching fact ids (not full content); callers use `get` to load them.
    search(content: string, access: MemoryAccessContext): Promise<Expected<string[]>>;

    // Ask the service's sub-agent to answer the request based on the memory.
    // Returns the answer.
    ask(question: string, access: MemoryAccessContext): Promise<Expected<string>>;
}
