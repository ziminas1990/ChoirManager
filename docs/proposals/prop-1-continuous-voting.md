# Continuous voting feature

## Background

So, the choir always need to add new pieces to the repertoire. We choose the best peices through a voiting procedure.

Now we want to use a brand new "continuous voiting" format. The idea is the follow:
1. we have a persistant list of piecies (candidates)
2. any chorister at any time can add a reaction for the piece
3. reactions can be recalculated to a score

Despite the score, each piece has an "anti-rating" - a number of choristers who don't like the piece agains all choristers who actually voted.

## Leader board

Bot should publish a leader board every N days. The leader board should display top-10 pieces in the following format:

`<position>. <name> - <score>`

Piece name should be a link to a message with the piece in the Telegram chat.

## Implementation details

### How reactions should be stored?

We should use a "backlog" model. It means that each reaction is logged as the following record:

```typescript
type ReactionRecord = {
    date: Date;
    user_id: string;
    piece_id: string;
    reaction: number; // a unique id of reaction
    action: "set" | "remove";
}
```

We need to have an abstraction over backlog storage. It should provide methods to:
1. add a new record
2. find all records for a given piece
3. find all records for a given user

The simplest implementation is to use a local CSV file, that will be loaded to the memory on startup and updated with each new record.

### How does a list of pieces should be provided?

We should introduce a new abstraction, that fetches voiting pieces list. It provides just a single `fetch_all()` method, that returns a whole list of pieces. Each record should have the following fields:

```typescript
type Piece = {
    chat_id: number;
    message_id: number;
    name: string;
    author: string;
    link?: string; // link to youtube video or other source
    difficulty?: number; // 1-5
}
```

For now, the abstraction should be implemented using Google Sheets adapter.

### Reaction to score mapping

Reaction to score mapping should be hardcoded for now. Bot should handle only "ReactionTypeEmoji", where:
- "❤", "👍" is 2 points
- "🔥", "🎉" is 3 points
- "👎" is -2 point

### How does the bot track reactions?

Each piece has a message in Telegram chat. Bot has admins access to the chat and a list of messages links.
Since Telegram Bot API doesn't allow to get reactions list for the message, that are related to the pieces.
Bot should subscribe to all reactions in the chat and handle new reactions events. If event relates to one of the messages in the list, but should add corresponding record to the backlog.

### How does bot calculate scores for each piece?

To calculate score for each piece by some point of time T, but should:
1. get all records for the piece from backlog that are older than T
2. filter-out records, that relates to the chorister, who left the choir before T
3. group records by user_id, and calculate a score for each user:
3.1 sort records by date in ascending order
3.2 create a boolean flag for each reaction that is false by default
3.3 iterate over all records and on each "action=set" set the flag for the reaction, while on each "action=remove" unset the flag
3.4 filter out all reactions where flag is false. For the remaning reactions, calculate it's score and chose the biggest one
3. sum up all scores from 3.4 to get a final score for the piece

### How does bot builds a leader-board?

When bot needs to build a leader board for some point of time T, but should:
1. get all pieces from the database
2. calculate scores for each piece by time T
3. sort pieces by score in descending order

### How to handle reactions during downtime?

If user set/remove a reaction during the bot downtime, bot will receive all updates once it starts again.
It should handle them as usual by adding records to the backlog.

## Configuration

A piece-voiting module should be configured in the following way:

```typescript
type PieceVotingConfig = {
    first_leaderboard_day: string,  // YYYY-MM-DD
    leaderboard_time_utc: string,   // HH:MM
    leaderboard_interval_days: number,
    pieces_fetcher: {
        type: "google_sheets",
        spreadsheet_id: string,
        sheet_name: string,
    }
    backlog_storage: {
        type: "local_csv",
        filename: string,
    }
}
```