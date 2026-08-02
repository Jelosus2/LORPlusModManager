import type { AutomaticUpdatePreferences, UpdateComponent } from "../../../shared/updates.js";

import { AppDatabase } from "#database/AppDatabase.js";

type SettingRow = {
    value: string;
}

export class SettingsRepository {
    private static readonly GAME_LOCATION_KEY = "game_location";
    private static readonly LO_PLUGIN_VERSION_KEY = "lo_plugin_version";
    private static readonly AUTOMATIC_UPDATE_KEYS: Readonly<Record<UpdateComponent, string>> = {
        application: "check_app_update",
        plugin: "check_plugin_update",
        catalog: "check_catalog_update"
    };

    getGameLocation(): string | null {
        return this.getSetting(SettingsRepository.GAME_LOCATION_KEY);
    }

    getLOPluginVersion(): string | null {
        return this.getSetting(SettingsRepository.LO_PLUGIN_VERSION_KEY);
    }

    getAutomaticUpdatePreference(component: UpdateComponent): boolean {
        return this.getBoolean(SettingsRepository.AUTOMATIC_UPDATE_KEYS[component], true);
    }

    getAutomaticUpdatePreferences(): AutomaticUpdatePreferences {
        return {
            application: this.getAutomaticUpdatePreference("application"),
            plugin: this.getAutomaticUpdatePreference("plugin"),
            catalog: this.getAutomaticUpdatePreference("catalog")
        };
    }

    private getBoolean(key: string, defaultValue: boolean): boolean {
        const value = this.getSetting(key);

        if (value === "1")
            return true;
        if (value === "0")
            return false;

        return defaultValue;
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

    setAutomaticUpdatePreference(component: UpdateComponent, enabled: boolean) {
        this.setSetting(SettingsRepository.AUTOMATIC_UPDATE_KEYS[component], enabled ? "1" : "0");
    }

    setGameSetup(gameLocation: string, pluginVersion: string) {
        if (!gameLocation.trim())
            throw new Error("The game location cannot be empty.");
        if (!pluginVersion.trim())
            throw new Error("The LOPlugin+ version cannot be empty.");

        const save = AppDatabase.connection.transaction(() => {
            this.setSetting(SettingsRepository.GAME_LOCATION_KEY, gameLocation);
            this.setSetting(SettingsRepository.LO_PLUGIN_VERSION_KEY, pluginVersion);
        });

        save();
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
