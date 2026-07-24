import { MemoryFact, NewMemoryFact } from "@src/entities/memory.js";
import { Expected } from "@src/utils/expected.js";

// Pure persistence: no access control, no caching.
export interface ISimpleMemoryStorage {
    create(fact: NewMemoryFact): Promise<Expected<MemoryFact>>;
    update(fact: MemoryFact): Promise<Expected<MemoryFact>>;
    delete(id: string): Promise<Expected<MemoryFact>>;
    get(id: string): Promise<Expected<MemoryFact>>;
    fetch_all(): Promise<Expected<MemoryFact[]>>;
}
