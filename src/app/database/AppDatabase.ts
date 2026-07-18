import { Migrations } from "./Migrations.js";
import { Paths } from "#utils/Paths.js";
import Database from "better-sqlite3";

export class AppDatabase {
    private static database: Database.Database | null = null;

    static initialize() {
        if (AppDatabase.database)
            return;

        const database = new Database(Paths.getDatabasePath());

        try {
            database.pragma("journal_mode = WAL");
            database.pragma("foreign_keys = ON");

            Migrations.runMigrations(database);

            AppDatabase.database = database;
        } catch (error) {
            database.close();
            throw error;
        }
    }

    static get connection() {
        if (!AppDatabase.database)
            throw new Error("The application database has not been initialized.");

        return AppDatabase.database;
    }

    static close() {
        AppDatabase.database?.close();
        AppDatabase.database = null;
    }
}
