import type { ModSourceKind, PersistedMod } from "../../../shared/mod.js";

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

type StoredModRow = {
    id: string;
    directoryName: string;
    sourceName: string;
    sourceKind: ModSourceKind;
    skin2dId: string;
    variantId: string | null;
    enabled: 0 | 1;
    importedAt: string;
    assetName: string | null;
};

type ModDirectoryRow = {
    directoryName: string;
};

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

    getAll(): readonly PersistedMod[] {
        const rows = AppDatabase.connection.prepare<[], StoredModRow>(`
            SELECT
                mods.id,
                mods.directory_name AS directoryName,
                mods.source_name AS sourceName,
                mods.source_kind AS sourceKind,
                mods.skin2d_id AS skin2dId,
                mods.variant_id AS variantId,
                mods.enabled,
                mods.imported_at AS importedAt,
                mod_assets.file_name AS assetName
            FROM mods
            LEFT JOIN mod_assets ON mod_assets.mod_id = mods.id
            ORDER BY
                mods.imported_at DESC,
                mods.id,
                mod_assets.file_name COLLATE NOCASE
        `).all();

        const mods = new Map<string, {
            id: string;
            directoryName: string;
            sourceName: string;
            sourceKind: ModSourceKind;
            skin2dId: string;
            variantId: string | null;
            enabled: boolean;
            importedAt: string;
            assetNames: string[];
        }>();

        for (const row of rows)
        {
            let mod = mods.get(row.id);

            if (!mod)
            {
                mod = {
                    id: row.id,
                    directoryName: row.directoryName,
                    sourceName: row.sourceName,
                    sourceKind: row.sourceKind,
                    skin2dId: row.skin2dId,
                    variantId: row.variantId,
                    enabled: row.enabled === 1,
                    importedAt: row.importedAt,
                    assetNames: []
                };

                mods.set(row.id, mod);
            }

            if (row.assetName)
                mod.assetNames.push(row.assetName);
        }

        return [...mods.values()];
    }

    getDirectoryNames(): readonly string[] {
        const rows = AppDatabase.connection.prepare<[], ModDirectoryRow>(`
            SELECT directory_name AS directoryName FROM mods ORDER BY directory_name COLLATE NOCASE
        `).all();

        return rows.map((row) => row.directoryName);
    }

    deleteById(id: string): boolean {
        const result = AppDatabase.connection.prepare(`DELETE FROM mods WHERE id = ?`).run(id);
        return result.changes === 1;
    }

    getDirectoryName(id: string): string | null {
        const row = AppDatabase.connection.prepare<[string], { directoryName: string }>(`
            SELECT directory_name AS directoryName FROM mods WHERE id = ?
        `).get(id);

        return row?.directoryName ?? null;
    }

    setDirectoryName(id: string, directoryName: string): boolean {
        const result = AppDatabase.connection.prepare(`UPDATE mods SET directory_name = ? WHERE id = ?`).run(directoryName, id);
        return result.changes === 1;
    }

    directoryNameExists(directoryName: string, excludeModId: string): boolean {
        const row = AppDatabase.connection.prepare(`
            SELECT 1 FROM mods WHERE directory_name = ? AND id <> ? LIMIT 1
        `).get(directoryName, excludeModId);

        return row !== undefined;
    }

    setEnabled(id: string, enabled: boolean): boolean {
        const result = AppDatabase.connection.prepare("UPDATE mods SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
        return result.changes === 1;
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
