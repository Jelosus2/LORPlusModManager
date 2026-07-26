import type Database from "better-sqlite3";

type Migration = (database: Database.Database) => void;

export class Migrations {
    private static readonly migrations: Migration[] = [
        (database) => {
            database.exec(`
                CREATE TABLE settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) WITHOUT ROWID;
            `);
        },
        (database) => {
            database.exec(`
                CREATE TABLE mods (
                    id TEXT PRIMARY KEY,
                    directory_name TEXT NOT NULL
                        COLLATE NOCASE
                        UNIQUE,
                    source_name TEXT NOT NULL,
                    source_kind TEXT NOT NULL CHECK (
                        source_kind IN ('zip', 'asset-bundle')
                    ),
                    skin2d_id TEXT NOT NULL,
                    variant_id TEXT CHECK (
                        variant_id IS NULL OR length(trim(variant_id)) > 0
                    ),
                    enabled INTEGER NOT NULL DEFAULT 0
                        CHECK (enabled IN (0, 1)),
                    imported_at TEXT NOT NULL DEFAULT (
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    )
                ) WITHOUT ROWID;

                CREATE INDEX mods_catalog_entry_index ON mods (skin2d_id, variant_id);

                CREATE TABLE mod_assets (
                    mod_id TEXT NOT NULL,
                    file_name TEXT NOT NULL
                        COLLATE NOCASE,
                    PRIMARY KEY (mod_id, file_name),
                    FOREIGN KEY (mod_id)
                        REFERENCES mods (id)
                        ON DELETE CASCADE
                ) WITHOUT ROWID;

                CREATE INDEX mod_assets_file_name_index ON mod_assets (file_name COLLATE NOCASE);
            `);
        }
    ];

    static runMigrations(database: Database.Database) {
        const currentVersion = database.pragma("user_version", { simple: true }) as number;
        if (currentVersion > Migrations.migrations.length)
            throw new Error("The database was created by a newer application version.");

        for (let i = currentVersion; i < Migrations.migrations.length; i++)
        {
            const migration = Migrations.migrations[i];

            database.transaction(() => {
                migration(database);
                database.pragma(`user_version = ${i + 1}`);
            })();
        }
    }
}
