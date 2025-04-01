import { Voice } from "@src/database.js"


export type Feedback = {
    date: Date
    feedback: string
    who?: string,
    voice?: Voice
}
