

export type PackedMap<K, P> = [K, P][];

export function pack_map<K, V, P>(map: Map<K, V>, packer: (value: V) => P): PackedMap<K, P> {
    return Array.from(map.entries()).map(([key, value]) => [key, packer(value)]);
}

export function unpack_map<K, V, P>(map: PackedMap<K, P>, unpacker: (packed: P) => V | undefined): Map<K, V> {
    const items = map.map(([key, packed]) => [key, unpacker(packed)] as const)
        .filter(([_, value]) => value != undefined) as [K, V][];
    return new Map(items);
}