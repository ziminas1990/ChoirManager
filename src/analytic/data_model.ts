import { Status, StatusWith } from "../status.js";

type PackedMap<K, P> = [K, P][];

function pack_map<K, V, P>(map: Map<K, V>, pack: (v: V) => P): PackedMap<K, P> {
    return Array.from(map.entries()).map(([k, v]) => [k, pack(v)]);
}

function unpack_map<K, V, P>(data: PackedMap<K, P>, unpack: (p: P) => V): Map<K, V> {
    return new Map(data.map(([k, p]) => [k, unpack(p)]));
}

export enum Vocal {
    Unknown = 0,
    Soprano = 1,
    Alto    = 2,
    Tenor   = 3,
    Bass    = 4
}

export type ChoristerId = number;
export type RehersalId = number;
export type PieceId = number;

abstract class Entity<T> {
    constructor(public id: number, private keys: (keyof T)[]) {}

    equal(other: Partial<T>): boolean {
        const self = this as unknown as T;
        return this.keys.every(key => other[key] === undefined || self[key] === other);
    }

    update(other: Partial<T>, verbose: boolean = false): string[] {
        const changes: string[] = [];
        const self = this as unknown as T;
        this.keys.forEach(key => {
            if (other[key] !== undefined && self[key] !== other[key]) {
                if (verbose) {
                    changes.push(`${String(key)}: ${self[key]} -> ${other[key]}`);
                }
                self[key] = other[key] as T[keyof T];
            }
        });
        return changes;
    }
}

type PackedChoristerEntity = [ChoristerId, string, string, Vocal, number];

export class ChoristerEntity extends Entity<ChoristerEntity> {
    constructor(
        id: ChoristerId,
        public name: string,
        public surname: string,
        public vocal: Vocal,
        public joined: Date
    ) {
        super(id, ['name', 'surname', 'vocal']);
    }

    static pack(data: ChoristerEntity): PackedChoristerEntity {
        return [data.id, data.name, data.surname, data.vocal, data.joined.getTime()];
    }

    static unpack(data: PackedChoristerEntity): ChoristerEntity {
        return new ChoristerEntity(data[0], data[1], data[2], data[3] as Vocal, new Date(data[4]));
    }
}

type PackedPieceEntity = [PieceId, string, string];

export class PieceEntity extends Entity<PieceEntity> {
    constructor(
        id: PieceId,
        public author: string,
        public title: string
    ) {
        super(id, ['author', 'title']);
    }

    static pack(data: PieceEntity): PackedPieceEntity {
        return [data.id, data.author, data.title];
    }

    static unpack(data: PackedPieceEntity): PieceEntity {
        return new PieceEntity(data[0], data[1], data[2]);
    }
}

type PackedChoristerOnRehersal = [number]

export class ChoristerOnRehersal {
    constructor(public time_minutes: number) {}

    static pack(data: ChoristerOnRehersal): PackedChoristerOnRehersal {
        return [data.time_minutes];
    }

    static unpack(data: PackedChoristerOnRehersal): ChoristerOnRehersal {
        return new ChoristerOnRehersal(data[0]);
    }
}

type PackedPieceOnRehersal = [number];

export class PieceOnRehersal {
    constructor(public time_minutes: number) {}

    static pack(data: PieceOnRehersal): PackedPieceOnRehersal {
        return [data.time_minutes];
    }

    static unpack(data: PackedPieceOnRehersal): PieceOnRehersal {
        return new PieceOnRehersal(data[0]);
    }
}

type PackedRehersalEntity = [
    RehersalId, number,
    PackedMap<number, PackedPieceOnRehersal>,
    PackedMap<number, PackedChoristerOnRehersal>
];

export class RehersalEntity extends Entity<RehersalEntity> {
    public when: number;

    public pieces: Map<PieceId, PieceOnRehersal> = new Map();
    public participants: Map<ChoristerId, ChoristerOnRehersal> = new Map();

    constructor(
        id: RehersalId,
        date: Date
    )
    {
        super(id, ["when"]);
        this.when = date.getTime();
    }

    duration(): number {
        // 2 hours if wednesday and 3 hours if sunday
        const day = new Date(this.when).getDay();
        if (day === 3) {
            return 2 * 60;
        } else if (day === 0) {
            return 3 * 60;
        } else {
            return 0;
        }
    }

    static pack(data: RehersalEntity): PackedRehersalEntity {
        return [
            data.id, data.when,
            pack_map(data.pieces, PieceOnRehersal.pack),
            pack_map(data.participants, ChoristerOnRehersal.pack)
        ];
    }

    static unpack(data: PackedRehersalEntity): RehersalEntity {
        const rehersal = new RehersalEntity(data[0], new Date(data[1]));
        rehersal.pieces = unpack_map(data[2], PieceOnRehersal.unpack);
        rehersal.participants = unpack_map(data[3], ChoristerOnRehersal.unpack);
        return rehersal;
    }
}

type PackedDatabase = [
    PackedMap<number, PackedChoristerEntity>,
    PackedMap<number, PackedPieceEntity>,
    PackedMap<number, PackedRehersalEntity>,
];

export class Database {
    public choristers: Map<number, ChoristerEntity> = new Map();
    public pieces: Map<number, PieceEntity> = new Map();
    public rehersals: Map<number, RehersalEntity> = new Map();

    create_chorister(chorister_id: number, name: string, surname: string, vocal: Vocal, joined: Date)
    : StatusWith<ChoristerEntity> {
        if (this.choristers.has(chorister_id)) {
            return Status.fail(`Chorister #${chorister_id} already exists`);
        }
        const chorister = new ChoristerEntity(chorister_id, name, surname, vocal, joined);
        this.choristers.set(chorister_id, chorister);
        return Status.ok().with(chorister);
    }

    get_chorister(what: Partial<ChoristerEntity> | RehersalId): StatusWith<ChoristerEntity> {
        if (typeof what === "number") {
            const chorister = this.choristers.get(what);
            return chorister ? Status.ok().with(chorister)
                             : Status.fail(`Chorister #${what} not found`);
        }
        return Database.find_in_map(this.choristers, what);
    }

    create_piece(piece_id: number, author: string, title: string): StatusWith<PieceEntity> {
        if (this.pieces.has(piece_id)) {
            return Status.fail(`Piece #${piece_id} already exists`);
        }

        const piece = new PieceEntity(piece_id, author, title);
        this.pieces.set(piece_id, piece);
        return Status.ok().with(piece);
    }

    get_piece(what: Partial<PieceEntity> | RehersalId): StatusWith<PieceEntity> {
        if (typeof what === "number") {
            const rehersal = this.rehersals.get(what);
            return rehersal ? Status.ok().with(rehersal)
                            : Status.fail(`Rehersal #${what} not found`);
        }
        return Database.find_in_map(this.pieces, what);
    }

    create_rehersal(id: number, date: Date): StatusWith<RehersalEntity> {
        if (this.rehersals.has(id)) {
            return Status.fail(`Rehersal #${id} already exists`);
        }
        const rehersal = new RehersalEntity(id, date);
        this.rehersals.set(id, rehersal);
        return Status.ok().with(rehersal);
    }

    get_rehersal(what: Partial<RehersalEntity> | RehersalId): StatusWith<RehersalEntity> {
        if (typeof what === "number") {
            const rehersal = this.rehersals.get(what);
            return rehersal ? Status.ok().with(rehersal)
                            : Status.fail(`Rehersal #${what} not found`);
        }
        return Database.find_in_map(this.rehersals, what);
    }

    join_rehersal(chorister_id: ChoristerId, rehersal_id: RehersalId, time_minutes: number): Status
    {
        const rehersal_status = this.get_rehersal(rehersal_id);
        if (!rehersal_status.done() || !rehersal_status.value) {
            return rehersal_status.wrap("Rehersal not found");
        }
        const rehersal = rehersal_status.value;
        if (rehersal.participants.has(chorister_id)) {
            return Status.fail("Chorister already joined");
        }
        rehersal.participants.set(chorister_id, { time_minutes });
        return Status.ok();
    }

    rehersal_song(rehersal_id: RehersalId, song_id: PieceId, time_minutes: number): Status
    {
        const rehersal_status = this.get_rehersal(rehersal_id);
        if (!rehersal_status.done() || !rehersal_status.value) {
            return rehersal_status.wrap("Rehersal not found");
        }

        const piece_status = this.get_piece(song_id);
        if (!piece_status.done() || !piece_status.value) {
            return piece_status.wrap("Piece not found");
        }

        const rehersal = rehersal_status.value;
        if (rehersal.pieces.has(song_id)) {
            return Status.fail("piece has already been added to rehersal");
        }

        rehersal.pieces.set(song_id, { time_minutes });
        return Status.ok();
    }

    static pack(data: Database): PackedDatabase {
        return [
            pack_map(data.choristers, ChoristerEntity.pack),
            pack_map(data.pieces, PieceEntity.pack),
            pack_map(data.rehersals, RehersalEntity.pack),
        ];
    }

    static unpack(data: PackedDatabase): Database {
        const db = new Database();
        db.choristers = unpack_map(data[0], ChoristerEntity.unpack);
        db.pieces = unpack_map(data[1], PieceEntity.unpack);
        db.rehersals = unpack_map(data[2], RehersalEntity.unpack);
        return db;
    }

    private static find_in_map<T extends Entity<T>>(array: Map<number, T>, pattern: Partial<T>)
    : StatusWith<T> {
        if (pattern.id !== undefined) {
            const found = array.get(pattern.id);
            return found ? Status.ok().with(found as T)
                         : Status.fail("Not found").with<T>(undefined);
        }
        const found = Array.from(array.values()).find(e => e.equal(pattern));
        return found ? Status.ok().with(found as T)
                     : Status.fail("Not found").with<T>(undefined);
    }
}