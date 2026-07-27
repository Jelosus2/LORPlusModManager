import type { InstalledMod, ModVerification, PersistedMod } from "../../shared/mod.js";

import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export class ModVerifier {
    private readonly VERIFICATION_CONCURRENCY = 8;

    async verifyAll(mods: readonly PersistedMod[]): Promise<readonly InstalledMod[]> {
        if (mods.length === 0)
            return [];

        const results = new Array<InstalledMod>(mods.length);
        let nextIndex = 0;

        const verifyNext = async () => {
            while (true)
            {
                const index = nextIndex++;
                if (index >= mods.length)
                    return;

                results[index] = await this.verify(mods[index]);
            }
        };

        const workerCount = Math.min(this.VERIFICATION_CONCURRENCY, mods.length);
        await Promise.all(Array.from({ length: workerCount }, () => verifyNext()));

        return results;
    }

    private async verify(mod: PersistedMod): Promise<InstalledMod> {
        const modsRoot = Paths.getModsPath();
        const modDirectory = path.join(modsRoot, mod.directoryName);

        if (!this.isInsideModsDirectory(modsRoot, modDirectory))
        {
            return this.withVerification(mod, {
                status: "unreadable",
                missingAssets: [...mod.assetNames]
            });
        }

        try
        {
            const entries = await fse.readdir(modDirectory, { withFileTypes: true });
            const availableFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
            const missingAssets = mod.assetNames.filter((assetName) => !availableFiles.has(assetName.toLowerCase()));

            return this.withVerification(mod, {
                status: missingAssets.length > 0
                    ? "missing-assets"
                    : "valid",
                missingAssets
            });
        }
        catch (error)
        {
            const code = TypeCheck.isNodeError(error)
                ? error.code
                : "";

            return this.withVerification(mod, {
                status: code === "ENOENT" || code === "ENOTDIR"
                    ? "missing-directory"
                    : "unreadable",
                missingAssets: [...mod.assetNames]
            });
        }
    }

    private isInsideModsDirectory(modsRoot: string, candidate: string): boolean {
        const relative = path.relative(modsRoot, candidate);
        return Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    }

    private withVerification(mod: PersistedMod, verification: ModVerification): InstalledMod {
        return {
            ...mod,
            verification
        };
    }
}
