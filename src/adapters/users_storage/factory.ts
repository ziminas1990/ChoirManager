import {
    PlainCollectionConfig,
    PlainCollectionFactory,
} from "@src/adapters/plain_collection/factory.js";
import { PackedPlainCollection } from "@src/components/collections/packed_plain_collection.js";
import { UserData } from "@src/entities/user.js";
import { ICollection } from "@src/interfaces/collection.js";
import { UserPatch } from "@src/interfaces/user_service.js";
import { Journal } from "@src/journal.js";
import { Expected, Status } from "@src/utils/expected.js";
import {
    apply_user_patch,
    from_user_data,
    to_user_data,
    user_firestore_converter,
} from "./user_mapper.js";

export type UsersStorageConfig = PlainCollectionConfig;

export class UsersStorageFactory {
    static verify(config: UsersStorageConfig): Status {
        return PlainCollectionFactory.verify(config);
    }

    static create(config: UsersStorageConfig, parent_journal: Journal)
    : Expected<ICollection<UserData, UserPatch>>
    {
        const collection_status = PlainCollectionFactory.create(
            config,
            user_firestore_converter(),
            parent_journal,
        );
        if (!collection_status.ok) {
            return collection_status.wrap_error("can't create users collection");
        }
        return Expected.ok(new PackedPlainCollection(
            collection_status.value,
            (user) => from_user_data(user, 0),
            to_user_data,
            apply_user_patch,
            (user) => user.id.system_id,
            parent_journal,
        ));
    }
}
