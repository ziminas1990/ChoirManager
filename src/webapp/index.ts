import { Database, RehersalSummary } from "../data_model"

declare var packed_json: any;

let db = Database.unpack(packed_json);

function rehersal_to_string(rehersal: RehersalSummary) {
    const lines = [(new Date(rehersal.date)).toISOString(), `${rehersal.duration} minutes`];
    rehersal.pieces.forEach(song => {
        lines.push(`  ${song.piece.title}: ${song.time} minutes`);
    });
    return lines.join('<br>');
}

db.fetch_rehersals_summary().forEach(rehersal => {
    const rehersal_div = document.createElement('div');
    rehersal_div.innerHTML = rehersal_to_string(rehersal);
    document.body.appendChild(rehersal_div);
    document.body.appendChild(document.createElement('hr'));
});