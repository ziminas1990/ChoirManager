import { Voice } from "@src/tgbot/database.js"


export type Feedback = {
    date: Date
    feedback: string
    who?: string,
    voice?: Voice
}
