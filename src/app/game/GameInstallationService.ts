import { UserFacingError } from "#utils/ErrorUtils.js";
import { GameRegistry } from "./GameRegistry.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import path from "node:path";
import fse from "fs-extra";

export class GameInstallationService {
    async detect(): Promise<string> {
        const installationPath = await GameRegistry.getInstallPath();
        if (!installationPath)
            throw new UserFacingError("Could not automatically discover the game location.");

        try
        {
            return await this.validate(installationPath);
        }
        catch (error)
        {
            throw new UserFacingError("The detected game location is not a valid Last Origin R+ installation.", { cause: error });
        }
    }

    async validate(value: unknown): Promise<string> {
        if (!TypeCheck.isValidString(value, 2048))
            throw new UserFacingError("The game location is invalid.");

        const installationPath = path.resolve(value);
        if (!await fse.exists(installationPath))
            throw new UserFacingError("The selected game location no longer exists.");

        const stats = await fse.stat(installationPath);
        if (!stats.isDirectory())
            throw new UserFacingError("The selected game location is not a directory.");

        const executableFileName = await GameRegistry.getExecutableFileName() ?? "LAST ORIGIN R+.exe";
        const executablePath = path.join(installationPath, executableFileName);

        if (!await fse.exists(executablePath))
            throw new UserFacingError(`The selected location does not contain ${executableFileName}.`);

        const executableStats = await fse.stat(executablePath);
        if (!executableStats.isFile())
            throw new UserFacingError(`${executableFileName} is not a file.`);

        return installationPath;
    }
}
