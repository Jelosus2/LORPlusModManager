import type { ModLibraryLocationProgress } from "../../shared/application.js";

import { directoryStorageService } from "#maintenance/DirectoryStorageService.js";
import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ModRecoveryCoordinator } from "./ModRecoveryCoordinator.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { ModSynchronizer } from "./ModSynchronizer.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type ProgressReporter = (value: ModLibraryLocationProgress) => void;
type ByteProgressReporter = (file: string, bytes: number) => void;

export class ModLibraryLocationService {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();

    async validateDestination(selectedPath: string): Promise<string> {
        const selected = path.resolve(selectedPath);
        const stats = await fse.lstat(selected);

        if (!stats.isDirectory() || stats.isSymbolicLink())
            throw new UserFacingError("Select a regular folder for the mod library.");

        const destination = await fse.realpath(selected);
        const source = await this.canonicalPath(Paths.getModsPath());

        if (Paths.isSamePath(source, destination))
            return source;

        const defaultLocation = await this.canonicalPath(Paths.getDefaultModsPath());
        const userData = await this.canonicalPath(Paths.getUserDataPath());
        const gameLocation = this.settingsRepository.getGameLocation();
        const protectedPaths = [await this.canonicalPath(Paths.getAppPath())];

        if (gameLocation)
            protectedPaths.push(await this.canonicalPath(gameLocation));

        if (
            Paths.isSamePath(destination, path.parse(destination).root) ||
            Paths.overlaps(source, destination) ||
            (!Paths.isSamePath(destination, defaultLocation) && Paths.overlaps(userData, destination)) ||
            protectedPaths.some((root) => Paths.overlaps(root, destination))
        )
        {
            throw new UserFacingError("Choose a separate folder outside the current library, game, and application folders.");
        }

        if ((await fse.readdir(destination)).length > 0)
            throw new UserFacingError("Choose an empty folder for the mod library.");

        return destination;
    }

    async move(selectedPath: string, reportProgress: ProgressReporter): Promise<string> {
        let progress: number | null = null;
        let lastReport = 0;

        const report = (status: string, detail = "", force = true) => {
            const now = Date.now();
            if (!force && now - lastReport < 100)
                return;

            lastReport = now;
            reportProgress({ progress, status, detail });
        };

        report("Preparing the library...");

        await ModRecoveryCoordinator.waitUntilReady();

        const destination = await this.validateDestination(selectedPath);
        const source = await this.canonicalPath(Paths.getModsPath());

        if (Paths.isSamePath(source, destination))
            return "";

        if (!await fse.exists(source) && this.modRepository.getAll().length > 0)
            throw new UserFacingError("The current mod library is unavailable. Reconnect it before changing its location.");

        await fse.ensureDir(source);

        const staging = await fse.mkdtemp(path.join(path.dirname(destination), ".lorplus-mods-"));
        let published = false;
        let committed = false;

        try
        {
            if (this.modRepository.getAll().some((mod) => mod.enabled))
            {
                report("Unsyncing mods...");

                const result = await new ModSynchronizer().synchronize(
                    { method: "unsync", enabledModIds: [] },
                    (value) => report("Unsyncing mods...", `${value.status} · ${value.detail}`, false)
                );

                if (!result.success)
                {
                    const failures = result.entries.filter((entry) => entry.status === "failed");

                    throw new UserFacingError(
                        "The location was not changed because some mods could not be unsynced. " +
                        failures
                            .map((entry) => entry.directoryName + ": " + entry.message)
                            .join(" ")
                    );
                }
            }

            for (const directory of [Paths.getOperationsRoot(), Paths.getSyncOperationsRoot()])
            {
                if (await fse.exists(directory) && (await fse.readdir(directory)).length > 0)
                    throw new UserFacingError("Finish recovering interrupted mod operations before moving the library.");
            }

            report("Measuring the library...");

            const { sizeBytes } = await directoryStorageService.measure(source);
            let processedBytes = 0;
            progress = 0;

            const countBytes = (status: string) => (file: string, bytes: number) => {
                processedBytes += bytes;

                progress = sizeBytes > 0
                    ? Math.min(99, processedBytes / (sizeBytes * 4) * 99)
                    : 99;

                report(status, file, false);
            };

            report("Reading library files...");
            const original = await this.snapshot(source, countBytes("Reading library files..."));

            report("Copying library files...");
            await this.copyWithProgress(source, staging, countBytes("Copying library files..."));

            report("Checking copied files...");
            const copied = await this.snapshot(staging, countBytes("Checking copied files..."));

            if (original !== copied)
                throw new UserFacingError("The copied library did not match the original. The location was not changed.");

            report("Rechecking original files...");
            const rechecked = await this.snapshot(source, countBytes("Rechecking original files..."));

            if (original !== rechecked)
                throw new UserFacingError("The original library changed during the move. The location was not changed.");

            progress = 99;
            report("Saving the new location...");

            const checkedDestination = await this.validateDestination(destination);

            if (!Paths.isSamePath(checkedDestination, destination))
                throw new UserFacingError("The selected folder changed during the move.");

            await fse.rmdir(destination);

            try
            {
                await fse.rename(staging, destination);
            }
            catch (error)
            {
                await fse.ensureDir(destination);
                throw error;
            }

            published = true;

            this.settingsRepository.setModLibraryLocation(destination);
            Paths.setModsPath(destination);

            committed = true;
            report("Removing the old library...");

            try
            {
                await fse.rm(source, { recursive: true, force: true });

                progress = 100;
                report("Library moved", destination);

                return "";
            }
            catch (error)
            {
                ApplicationLogger.warning(ApplicationLogSource.modLibrary, "Could not remove the old mod library.", error);

                progress = 100;
                report("Library moved", destination);

                return `The new location is active, but some files remain in ${source}.`;
            }
        }
        catch (error)
        {
            if (published && !committed)
                throw ErrorUtils.withContext(`The original library is still active. An additional copy remains in ${destination}.`, error);

            throw ErrorUtils.withContext("The library location was not changed. Some mods may already have been unsynced.", error);
        }
        finally
        {
            if (!published)
            {
                report("Removing the temporary copy...");

                try
                {
                    await fse.rm(staging, { recursive: true, force: true });
                }
                catch (error)
                {
                    ApplicationLogger.warning(
                        ApplicationLogSource.modLibrary,
                        `Could not remove the temporary library copy at ${staging}.`,
                        error
                    );
                }
            }
        }
    }

    private async canonicalPath(value: string): Promise<string> {
        const resolved = path.resolve(value);

        try
        {
            return await fse.realpath(resolved);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code !== "ENOENT")
                throw error;

            const parent = path.dirname(resolved);
            if (parent === resolved)
                throw error;

            return path.join(await this.canonicalPath(parent), path.basename(resolved));
        }
    }

    private async *walk(root: string, relativePath = ""): AsyncGenerator<{
        filePath: string;
        relativePath: string;
        directory: boolean;
    }> {
        const filePath = path.join(root, relativePath);
        const stats = await fse.lstat(filePath);

        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()))
            throw new UserFacingError("The mod library contains linked or unsupported files.");

        yield {
            filePath,
            relativePath,
            directory: stats.isDirectory()
        };

        if (stats.isDirectory())
        {
            for (const name of (await fse.readdir(filePath)).sort())
                yield* this.walk(root, path.join(relativePath, name));
        }
    }

    private async snapshot(root: string, onBytes: ByteProgressReporter): Promise<string> {
        const entries: [string, string][] = [];

        for await (const entry of this.walk(root)) {
            if (entry.directory)
            {
                entries.push([entry.relativePath, "directory"]);
                continue;
            }

            const hash = createHash("sha256");

            for await (const chunk of fse.createReadStream(entry.filePath))
            {
                hash.update(chunk);
                onBytes(entry.relativePath, Buffer.byteLength(chunk));
            }

            entries.push([entry.relativePath, hash.digest("hex")]);
        }

        return JSON.stringify(entries);
    }

    private async copyWithProgress(source: string, destination: string, onBytes: ByteProgressReporter) {
        for await (const entry of this.walk(source)) {
            const target = path.join(destination, entry.relativePath);

            if (entry.directory)
            {
                await fse.ensureDir(target);
                continue;
            }

            const counter = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    onBytes(entry.relativePath, chunk.length);
                    callback(null, chunk);
                }
            });

            await pipeline(
                fse.createReadStream(entry.filePath),
                counter,
                fse.createWriteStream(target, { flags: "wx" })
            );
        }
    }
}
