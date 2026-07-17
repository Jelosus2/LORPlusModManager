import Winreg from "winreg";

export class GameRegistry {
    private static gameRegistry = new Winreg({
        hive: Winreg.HKCU,
        key: "\\SOFTWARE\\Valofe\\lastorigin-gl"
    });

    private static getRegistryValue(name: string) {
        return new Promise<string | null>((resolve) => {
            GameRegistry.gameRegistry.get(name, (error, result) => {
                if (error)
                {
                    console.error(`Failed to read registry key "${name}":`, error);
                    return resolve(null);
                }

                if (!result)
                    return resolve(null);

                resolve(result.value);
            });
        });
    }

    static async getInstallPath() {
        return GameRegistry.getRegistryValue("PATH");
    }

    static async getExecutableFileName() {
        return GameRegistry.getRegistryValue("FILENAME");
    }
}
