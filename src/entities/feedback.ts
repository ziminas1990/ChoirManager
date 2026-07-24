import { Voice } from "@src/entities/user.js"


export type Feedback = {
    date: Date
    details: string
    who?: {
        tgid: string
        name_surname: string
    },
    voice?: Voice
}
