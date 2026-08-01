import type { InstalledMod, ModVerification, PersistedMod } from "../../shared/mod.js";

import { ErrorUtils } from "#utils/ErrorUtils.js";
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

        if (!Paths.isSubpath(modsRoot, modDirectory))
        {
            return this.withVerification(mod, {
                status: "unreadable",
                missingAssets: [...mod.assetNames],
                message: "The imported mod directory is not inside the mods directory."
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
                missingAssets: missingAssets.length > 0
                    ? missingAssets
                    : [],
                message: missingAssets.length > 0
                    ? `${missingAssets.length} required ${missingAssets.length === 1 ? "asset is" : "assets are"} missing: ${missingAssets.join(", ")}.`
                    : ""
            });
        }
        catch (error)
        {
            const code = TypeCheck.isNodeError(error)
                ? error.code
                : "";

            let message: string;

            if (code === "ENOENT")
                message = "The imported mod directory no longer exists.";
            else if (code === "ENOTDIR")
                message = "Part of the imported mod path is not a directory.";
            else
                message = ErrorUtils.combineWithCause("The imported mod directory could not be read.", error);

            return this.withVerification(mod, {
                status: code === "ENOENT" || code === "ENOTDIR"
                    ? "missing-directory"
                    : "unreadable",
                missingAssets: [...mod.assetNames],
                message
            });
        }
    }

    private withVerification(mod: PersistedMod, verification: ModVerification): InstalledMod {
        return {
            ...mod,
            verification
        };
    }
}
