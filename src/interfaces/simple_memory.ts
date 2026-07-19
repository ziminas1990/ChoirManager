import {
    MemoryAccessContext,
    MemoryFact,
    NewMemoryFact,
} from "@src/entities/memory.js";
import { Expected, Status } from "@src/utils/expected.js";

// Pure persistence: no access control, no caching.
export interface ISimpleMemoryStorage {
    create(fact: NewMemoryFact): Promise<Expected<MemoryFact>>;
    update(fact: MemoryFact): Promise<Expected<MemoryFact>>;
    delete(id: string): Promise<Expected<MemoryFact>>;
    get(id: string): Promise<Expected<MemoryFact>>;
    fetch_all(): Promise<Expected<MemoryFact[]>>;
}

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

export class SimpleMemoryInstance {
    private static instance?: ISimpleMemoryService;

    static set_instance(instance: ISimpleMemoryService): void {
        this.instance = instance;
    }

    static has_instance(): boolean {
        return this.instance !== undefined;
    }

    static get_instance(): ISimpleMemoryService {
        if (!this.instance) {
            throw new Error("Simple memory instance not set");
        }
        return this.instance;
    }
}
