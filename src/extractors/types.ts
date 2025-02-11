

export type Chorister = {
    vocal: string,
    name: string,
    surname: string,
    joined: Date,
    minutes: number[]
}

export type Song = {
    name: string,
    minutes: number[]
}

export type Data = {
    participants: Chorister[],
    songs: Song[],
    rehersals: Date[]
}