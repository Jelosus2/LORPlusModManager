import { AppDatabase } from "#database/AppDatabase.js";

type SettingRow = {
    value: string;
}

export class SettingsRepository {
    private static readonly GAME_LOCATION_KEY = "game_location";

    getGameLocation(): string | null {
        const row = AppDatabase.connection
            .prepare("SELECT value FROM settings WHERE key = ?")
            .get(SettingsRepository.GAME_LOCATION_KEY) as SettingRow | undefined;

        return row?.value ?? null;
    }

    setGameLocation(gameLocation: string) {
        if (!gameLocation.trim())
            throw new Error("The game location cannot be empty.");

        AppDatabase.connection.prepare(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        `).run(SettingsRepository.GAME_LOCATION_KEY, gameLocation);
    }

    clearGameLocation() {
        AppDatabase.connection
            .prepare("DELETE FROM settings WHERE key = ?")
            .run(SettingsRepository.GAME_LOCATION_KEY);
    }
}
