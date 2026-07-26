import type { ModSourceKind } from "../../../shared/mod.js";

import { AppDatabase } from "#database/AppDatabase.js";

export type ImportedModRecord = Readonly<{
    id: string;
    directoryName: string;
    sourceName: string;
    sourceKind: ModSourceKind;
    skin2dId: string;
    variantId: string | null;
    assetNames: readonly string[];
}>;

export class ModRepository {
    addImportedMods(mods: readonly ImportedModRecord[]) {
        if (mods.length === 0)
            throw new Error("No imported mods were provided.");

        const database = AppDatabase.connection;

        const insertMod = database.prepare(`
            INSERT INTO mods (id, directory_name, source_name, source_kind, skin2d_id, variant_id) VALUES (
                @id, @directoryName, @sourceName, @sourceKind, @skin2dId, @variantId
            )
        `);
        const insertAsset = database.prepare(`INSERT INTO mod_assets (mod_id, file_name) VALUES (?, ?)`);
        const insertAll = database.transaction((records: readonly ImportedModRecord[]) => {
            for (const record of records)
            {
                this.validateRecord(record);

                insertMod.run({
                    id: record.id,
                    directoryName: record.directoryName,
                    sourceName: record.sourceName,
                    sourceKind: record.sourceKind,
                    skin2dId: record.skin2dId,
                    variantId: record.variantId
                });

                for (const assetName of record.assetNames)
                    insertAsset.run(record.id, assetName);
            }
        });

        insertAll(mods);
    }

    private validateRecord(record: ImportedModRecord) {
        if (!record.id.trim())
            throw new Error("A mod ID cannot be empty.");

        if (!record.directoryName.trim())
            throw new Error("A mod directory name cannot be empty.");

        if (!record.sourceName.trim())
            throw new Error("A mod source name cannot be empty.");

        if (!record.skin2dId.trim())
            throw new Error("A mod skin ID cannot be empty.");

        if (record.assetNames.length === 0)
            throw new Error("An imported mod must contain assets.");

        const assetNames = new Set<string>();

        for (const assetName of record.assetNames)
        {
            if (!assetName.trim())
                throw new Error("A mod asset name cannot be empty.");

            const key = assetName.toLowerCase();

            if (assetNames.has(key))
                throw new Error(`The mod contains duplicate asset information for ${assetName}.`);

            assetNames.add(key);
        }
    }
}
