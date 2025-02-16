import { Database, RehersalEntity } from "../data_model"

declare var packed_json: any;
import * as Plotly from 'plotly.js';

// Then use it as if it were imported normally.
//Plotly.newPlot('chart', data, layout);

const tester = document.getElementById('tester');
Plotly.newPlot(
    tester!,
    [{
        x: [1, 2, 3, 4, 5],
        y: [1, 2, 4, 8, 16]
    }],
    {
        margin: { t: 0 }
    }
);

const db = Database.unpack(packed_json);

function rehersal_to_string(rehersal: RehersalEntity) {
    const lines = [
        (new Date(rehersal.when)).toISOString(),
        `${rehersal.duration()} minutes`
    ];

    {
        const songs: string[] = [];
        rehersal.pieces.forEach((info, piece_id) => {
            songs.push(`${piece_id}: ${info.time_minutes}`);
        })
        lines.push("Songs: " + songs.join(', '));
    }

    return lines.join('<br>');
}

db.rehersals.forEach(rehersal => {
    const rehersal_div = document.createElement('div');
    rehersal_div.innerHTML = rehersal_to_string(rehersal);
    document.body.appendChild(rehersal_div);
    document.body.appendChild(document.createElement('hr'));
});