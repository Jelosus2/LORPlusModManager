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
        }
    ];

    static runMigrations(database: Database.Database) {
        const currentVersion = database.pragma("user_version", { simple: true }) as number;
        if (currentVersion > Migrations.migrations.length)
            throw new Error("The database was created by a newer application version.");

        for (let i = currentVersion; i < Migrations.migrations.length; i++) {
            const migration = Migrations.migrations[i];

            database.transaction(() => {
                migration(database);
                database.pragma(`user_version = ${i + 1}`);
            })();
        }
    }
}
