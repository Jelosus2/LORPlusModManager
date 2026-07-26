import { AppDatabase } from "#database/AppDatabase.js";

type SettingRow = {
    value: string;
}

export class SettingsRepository {
    private static readonly GAME_LOCATION_KEY = "game_location";
    private static readonly LO_PLUGIN_VERSION_KEY = "lo_plugin_version";

    getGameLocation(): string | null {
        return this.getSetting(SettingsRepository.GAME_LOCATION_KEY);
    }

    getLOPluginVersion(): string | null {
        return this.getSetting(SettingsRepository.LO_PLUGIN_VERSION_KEY);
    }

    private getSetting(key: string): string | null {
        const row = AppDatabase.connection
            .prepare("SELECT value FROM settings WHERE key = ?")
            .get(key) as SettingRow | undefined;

        return row?.value ?? null;
    }

    setGameLocation(gameLocation: string) {
        if (!gameLocation.trim())
            throw new Error("The game location cannot be empty.");

        this.setSetting(SettingsRepository.GAME_LOCATION_KEY, gameLocation);
    }

    setLOPluginVersion(version: string) {
        if (!version.trim())
            throw new Error("The LOPlugin+ version cannot be empty.");

        this.setSetting(SettingsRepository.LO_PLUGIN_VERSION_KEY, version);
    }

    private setSetting(key: string, value: string) {
        AppDatabase.connection.prepare(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        `).run(key, value);
    }
}
