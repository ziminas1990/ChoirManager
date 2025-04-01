import assert from "assert";

// NOTE: this type describes only parts of previous configuration that were somehow
// changed (moved, removed, renamed)in new configuration format
export type RuntimeV2 = {
    version: 2;
    // cfg should be moved to tg_adapter
    cfg?: {
        cfg: string;
        chat_id: number;
        announces_chat_id: number;
        manager_chat_id: number;
    }
    users: [
        string,
        {
            tgid: string,
            dlg?: number[]  // Should be moved to tg_adapter
        }
    ][]
}

export type RuntimeV3 = {
    tg_adapter: {
        choir_chat_id?: number,
        announce_thread_id?: number,
        managers_chat_id?: number,
        users: {
            tgid: string,
            chat_id?: number
        }[]
    },
}

export function update_v2_v3(v2: RuntimeV2): RuntimeV3 {
    assert(v2.version == 2);
    const v3: RuntimeV2 & RuntimeV3 = {
        ...v2,
        tg_adapter: {
            choir_chat_id: v2.cfg?.chat_id,
            announce_thread_id: v2.cfg?.announces_chat_id,
            managers_chat_id: v2.cfg?.manager_chat_id,
            users: v2.users.map(([_, user]) => ({
                tgid: user.tgid,
                chat_id: user.dlg && user.dlg.length > 0 ? user.dlg[0] : undefined
            }))
        }
    }
    // Remove deprecated fields
    delete(v3.cfg)
    if (v3.users) {
        for (const [_, user] of v3.users) {
            delete(user.dlg)
        }
    }
    return v3 as RuntimeV3;
}