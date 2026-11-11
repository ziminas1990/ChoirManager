
export function unexpected(): never {
    throw new Error("Unexpected call to an unconfigured test dependency");
}
