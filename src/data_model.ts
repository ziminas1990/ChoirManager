import { Status, StatusWith } from "./status.js";

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

    abstract clone(): T;
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

    pack(): PackedChoristerEntity {
        return [this.id, this.name, this.surname, this.vocal, this.joined.getTime()];
    }

    static unpack(data: PackedChoristerEntity): ChoristerEntity {
        return new ChoristerEntity(data[0], data[1], data[2], data[3] as Vocal, new Date(data[4]));
    }

    clone(): ChoristerEntity {
        return ChoristerEntity.unpack(this.pack());
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

    pack(): PackedPieceEntity {
        return [this.id, this.author, this.title];
    }

    static unpack(data: PackedPieceEntity): PieceEntity {
        return new PieceEntity(data[0], data[1], data[2]);
    }

    clone(): PieceEntity {
        return PieceEntity.unpack(this.pack());
    }
}


type PackedRehersalEntity = [RehersalId, number];

export class RehersalEntity extends Entity<RehersalEntity> {
    public when: number;

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

    pack(): PackedRehersalEntity {
        return [this.id, this.when];
    }

    static unpack(data: PackedRehersalEntity): RehersalEntity {
        return new RehersalEntity(data[0], new Date(data[1]));
    }

    clone(): RehersalEntity {
        return RehersalEntity.unpack(this.pack());
    }
}

type PackedSongRehersalRelation = [PieceId, RehersalId, number];

class SongRehersalRelation {
    constructor(public piece: PieceId, public rehersal: RehersalId, public time: number) {}

    pack(): PackedSongRehersalRelation {
        return [this.piece, this.rehersal, this.time];
    }

    static unpack(data: PackedSongRehersalRelation): SongRehersalRelation {
        return new SongRehersalRelation(data[0], data[1], data[2]);
    }
}

type PackedChoristerRehersalRelation = [ChoristerId, RehersalId];

class ChoristerRehersalRelation {
    constructor(public chorister: ChoristerId, public rehersal: RehersalId) {}

    pack(): PackedChoristerRehersalRelation {
        return [this.chorister, this.rehersal];
    }

    static unpack(data: PackedChoristerRehersalRelation): ChoristerRehersalRelation {
        return new ChoristerRehersalRelation(data[0], data[1]);
    }
}

export type RehersalSummary = {
    date: Date,
    duration: number,
    pieces: {
        piece: PieceEntity,
        time: number
    }[],
    choristers: ChoristerEntity[]
};

export class ChoristerSummary {

    constructor(
        public chorister: ChoristerEntity,
        public rehersals: RehersalEntity[])
    {
        rehersals.sort((a, b) => b.when - a.when);
    }
};

type PackedDatabase = [
    PackedChoristerEntity[],
    PackedPieceEntity[],
    PackedRehersalEntity[],
    PackedSongRehersalRelation[],
    PackedChoristerRehersalRelation[]
];

export class Database {
    public choristers: ChoristerEntity[] = [];
    public pieces: PieceEntity[] = [];
    public rehersals: RehersalEntity[] = [];
    public song_rehersals: SongRehersalRelation[] = [];
    public choristers_on_rehersals: ChoristerRehersalRelation[] = [];

    create_chorister(name: string, surname: string, vocal: Vocal, joined: Date): ChoristerEntity {
        const id = this.choristers.length;
        const chorister = new ChoristerEntity(id, name, surname, vocal, joined);
        this.choristers.push(chorister);
        return chorister;
    }

    get_chorister(what: Partial<ChoristerEntity>): StatusWith<ChoristerEntity> {
        return Database.find_in_array(this.choristers, what);
    }

    create_piece(author: string, title: string): PieceEntity {
        const id = this.pieces.length;
        const piece = new PieceEntity(id, author, title);
        this.pieces.push(piece);
        return piece.clone();
    }

    get_piece(what: Partial<PieceEntity>): StatusWith<PieceEntity> {
        return Database.find_in_array(this.pieces, what);
    }

    create_rehersal(date: Date): RehersalEntity {
        const id = this.rehersals.length;
        const rehersal = new RehersalEntity(id, date);
        this.rehersals.push(rehersal);
        // Sort rehersals by date in descending order, so that the most recent rehersal
        // goes first
        this.rehersals.sort((a, b) => b.when - a.when);
        return rehersal.clone();
    }

    join_rehersal(who: ChoristerEntity, rehersal: RehersalEntity): Status {
        const _rehersal = this.rehersals[rehersal.id];
        if (_rehersal === undefined) {
            return Status.fail(`Rehersal #${rehersal} not found`);
        }
        this.choristers_on_rehersals.push(
            new ChoristerRehersalRelation(who.id, rehersal.id));
        return Status.ok();
    }

    rehersal_song(rehersal: RehersalEntity, song: PieceEntity, time: number): Status {
        const _rehersal = this.rehersals[rehersal.id];
        if (_rehersal === undefined) {
            return Status.fail(`Rehersal #${rehersal} not found`);
        }
        const _song = this.pieces[song.id];
        if (_song === undefined) {
            return Status.fail(`Song #${song} not found`);
        }
        this.song_rehersals.push(new SongRehersalRelation(song.id, rehersal.id, time));
        return Status.ok();
    }

    fetch_rehersals_summary(): RehersalSummary[] {
        return this.rehersals.map(rehersal => {
            const pieces = this.song_rehersals
                .filter(sr => sr.rehersal === rehersal.id)
                .map(sr => {
                    const piece = this.pieces[sr.piece];
                    return {
                        piece: piece.clone(),
                        time: sr.time
                    };
                });
            const choristers = this.choristers_on_rehersals
                .filter(cr => cr.rehersal === rehersal.id)
                .map(cr => this.choristers[cr.chorister]);
            return {
                date: new Date(rehersal.when),
                duration: rehersal.duration(),
                pieces,
                choristers
            }; 
        });
    }

    fetch_choristers_summary(): ChoristerSummary[] {
        return this.choristers.map(chorister => {
            const rehersals = this.choristers_on_rehersals
                .filter(cr => cr.chorister === chorister.id)
                .map(cr => this.rehersals[cr.rehersal]);
            return new ChoristerSummary(chorister.clone(), rehersals);
        });
    }

    pack(): PackedDatabase {
        return [
            this.choristers.map(c => c.pack()),
            this.pieces.map(p => p.pack()),
            this.rehersals.map(r => r.pack()),
            this.song_rehersals.map(sr => sr.pack()),
            this.choristers_on_rehersals.map(cr => cr.pack())
        ];
    }

    static unpack(data: PackedDatabase): Database {
        const db = new Database();
        db.choristers = data[0].map(c => ChoristerEntity.unpack(c));
        db.pieces = data[1].map(p => PieceEntity.unpack(p));
        db.rehersals = data[2].map(r => RehersalEntity.unpack(r));
        db.song_rehersals = data[3].map(sr => SongRehersalRelation.unpack(sr));
        db.choristers_on_rehersals = data[4].map(cr => ChoristerRehersalRelation.unpack(cr));
        return db;
    }

    private static find_in_array<T extends Entity<T>>(array: T[], pattern: Partial<T>)
    : StatusWith<T> {
        if (pattern.id !== undefined) {
            if (pattern.id < 0 || pattern.id >= array.length) {
                return Status.fail("Index out of bounds").with<T>(undefined);
            }
            return Status.ok().with(array[pattern.id] as T);
        }
        const found = array.find(e => e.equal(pattern));
        return found ? Status.ok().with(found as T)
                     : Status.fail("Not found").with<T>(undefined);
    }
}