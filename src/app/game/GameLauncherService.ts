import type { GameLaunchRequest, GameLaunchResult, GameLauncherRequirement } from "../../shared/game.js";
import type { IncomingMessage, Server } from "node:http";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { GameInstallationService } from "./GameInstallationService.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { createServer } from "node:http";
import { shell } from "electron";
import path from "node:path";
import fse from "fs-extra";

const LAUNCHER_FAILURE_REASONS = [
    "launcher_update_required",
    "game_not_installed",
    "game_update_required",
    "service_unavailable",
    "maintenance",
    "login_canceled",
    "game_already_running",
    "launch_canceled",
    "launch_failed"
] as const;

type LauncherFailureReason = typeof LAUNCHER_FAILURE_REASONS[number];

type LauncherCallbackResult =
    | Readonly<{ status: "started" }>
    | Readonly<{
        status: "failed";
        reason: LauncherFailureReason;
    }>;

type LauncherCallbackSession = Readonly<{
    callbackUrl: string;
    result: Promise<LauncherCallbackResult>;
    close: () => Promise<void>;
}>;

class LauncherCallbackTimeoutError extends UserFacingError {
    constructor() {
        super(
            "The launcher did not report whether the game started. Make sure LOLauncher is installed and its version is 1.0.5+"
        );

        this.name = "LauncherCallbackTimeoutError";
    }
}

export class GameLauncherService {
    private static readonly CALLBACK_HOST = "127.0.0.1";
    private static readonly CALLBACK_PORT = 53123;
    private static readonly CALLBACK_PATH = "/launcher-result";
    private static readonly CALLBACK_TIMEOUT = 5 * 60 * 1000;
    private static readonly MAXIMUM_CALLBACK_BODY_SIZE = 8 * 1024;
    private static readonly MINIMUM_LAUNCHER_VERSION = "1.0.5";
    private readonly settingsRepository = new SettingsRepository();
    private readonly installationService = new GameInstallationService();
    private isLaunchInProgress = false;

    async launch(rawRequest: unknown): Promise<GameLaunchResult> {
        if (this.isLaunchInProgress)
            throw new UserFacingError("A game launch is already in progress.");

        const request = this.parseRequest(rawRequest);
        this.isLaunchInProgress = true;

        let callbackSession: LauncherCallbackSession | null = null;
        let rollbackLoaderState: (() => Promise<void>) | null = null;

        try
        {
            const configuredLocation  = this.settingsRepository.getGameLocation();
            if (!configuredLocation )
                throw new UserFacingError("The game location has not been configured.");

            const gameLocation = await this.installationService.validate(configuredLocation);

            callbackSession = await this.createCallbackSession();
            rollbackLoaderState = await this.prepareLoaderState(gameLocation, request.vanilla);

            const protocolUrl = new URL("lolauncher://launch-game");
            protocolUrl.searchParams.set("callback", callbackSession.callbackUrl);

            try
            {
                await shell.openExternal(protocolUrl.toString());
            }
            catch (error)
            {
                const launcherError = new UserFacingError(
                    `LOLauncher ${GameLauncherService.MINIMUM_LAUNCHER_VERSION} or later is required to start the game.`,
                    { cause: error }
                );

                await this.restoreAfterFailedLaunch(launcherError, rollbackLoaderState);

                return this.createLauncherRequirementResult("install");
            }

            let result: LauncherCallbackResult;

            try
            {
                result = await callbackSession.result;
            }
            catch (error)
            {
                if (error instanceof LauncherCallbackTimeoutError)
                    throw error;

                return await this.failAfterRollback(error, rollbackLoaderState);
            }

            if (result.status === "failed")
            {
                const launcherError = new UserFacingError(this.getFailureReasonMessage(result.reason));

                if (result.reason === "launcher_update_required")
                {
                    await this.restoreAfterFailedLaunch(launcherError, rollbackLoaderState);

                    return this.createLauncherRequirementResult("update");
                }

                return await this.failAfterRollback(launcherError, rollbackLoaderState);
            }

            return { status: "started" };
        }
        finally
        {
            await callbackSession?.close();
            this.isLaunchInProgress = false;
        }
    }

    private async createCallbackSession(): Promise<LauncherCallbackSession> {
        let settled = false;
        let resolveResult!: (result: LauncherCallbackResult) => void;
        let rejectResult!: (error: unknown) => void;

        const result = new Promise<LauncherCallbackResult>((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        });

        const server = createServer((request, response) => {
            void this.handleCallbackRequest(request).then(
                (callbackResult) => {
                    response.statusCode = 204;
                    response.end();

                    if (!settled)
                    {
                        settled = true;
                        resolveResult(callbackResult);
                    }
                },
                (error) => {
                    response.statusCode = 400;
                    response.setHeader("Content-Type", "application/json");
                    response.end(JSON.stringify({
                        success: false,
                        message: "Invalid launcher callback."
                    }));

                    if (!settled)
                    {
                        settled = true;
                        rejectResult(error);
                    }
                }
            );
        });

        try
        {
            await this.listen(server);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "EADDRINUSE")
            {
                throw new UserFacingError(
                    `The launcher callback port ${GameLauncherService.CALLBACK_PORT} is already in use. Close the application using it and try again.`,
                    { cause: error }
                );
            }

            throw new UserFacingError("The local launcher callback server could not be started.", { cause: error });
        }

        server.on("error", (error) => {
            if (!settled)
            {
                settled = true;
                rejectResult(new UserFacingError("The local launcher callback server failed.", { cause: error }));
            }
        });

        const timeout = setTimeout(() => {
            if (settled)
                return;

            settled = true;
            rejectResult(new LauncherCallbackTimeoutError());
        }, GameLauncherService.CALLBACK_TIMEOUT);

        const close = async () => {
            clearTimeout(timeout);

            if (!server.listening)
                return;

            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        };

        return {
            callbackUrl: `http://${GameLauncherService.CALLBACK_HOST}:${GameLauncherService.CALLBACK_PORT}${GameLauncherService.CALLBACK_PATH}`,
            result,
            close
        };
    }

    private async prepareLoaderState(gameLocation: string, vanilla: boolean): Promise<() => Promise<void>> {
        const enabledPath = path.join(gameLocation, "winhttp.dll");
        const disabledPath = path.join(gameLocation, "_winhttp.dll");
        const enabledExists = await this.validateOptionalLoaderFile(enabledPath, "winhttp.dll");
        const disabledExists = await this.validateOptionalLoaderFile(disabledPath, "_winhttp.dll");
        const sourcePath = vanilla ? enabledPath : disabledPath;
        const destinationPath = vanilla ? disabledPath : enabledPath;
        const sourceExists = vanilla ? enabledExists : disabledExists;
        const destinationExists = vanilla ? disabledExists : enabledExists;

        if (!sourceExists)
            return async () => undefined;
        if (destinationExists)
            throw new UserFacingError(`Both winhttp.dll and _winhttp.dll exist in the game folder. Resolve the duplicate before launching the game.`);

        try
        {
            await fse.rename(sourcePath, destinationPath);
        }
        catch (error)
        {
            throw new UserFacingError(
                vanilla
                    ? "BepInEx could not be disabled for the vanilla launch."
                    : "BepInEx could not be restored for the modded launch.",
                { cause: error }
            );
        }

        return async () => {
            const renamedFileExists = await fse.pathExists(destinationPath);
            const originalFileExists = await fse.pathExists(sourcePath);

            if (!renamedFileExists)
                throw new UserFacingError(`The loader file "${path.basename(destinationPath)}" no longer exists.`);
            if (originalFileExists)
                throw new UserFacingError(`The loader file "${path.basename(sourcePath)}" already exists.`);

            await fse.rename(destinationPath, sourcePath);
        };
    }

    private async validateOptionalLoaderFile(filePath: string, fileName: string): Promise<boolean> {
        let stats: fse.Stats;

        try
        {
            stats = await fse.lstat(filePath);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return false;

            throw error;
        }

        if (!stats.isFile())
            throw new UserFacingError(`${fileName} exists in the game directory but is not a regular file.`);

        return true;
    }

    private async restoreAfterFailedLaunch(error: unknown, rollback: () => Promise<void>) {
        try
        {
            await rollback();
        }
        catch (rollbackError)
        {
            ApplicationLogger.error(
                ApplicationLogSource.gameLauncher,
                "Could not restore the BepInEx loader state after a failed launch.",
                rollbackError
            );

            const launchMessage = ErrorUtils.getUserErrorMessage(error, "The game could not be launched.");

            throw new UserFacingError(`${launchMessage} The previous BepInEx loader state could not be restored automatically.`, {
                cause: new AggregateError([error, rollbackError])
            });
        }
    }

    private async failAfterRollback(error: unknown, rollback: () => Promise<void>): Promise<never> {
        await this.restoreAfterFailedLaunch(error, rollback);
        throw error;
    }

    private async handleCallbackRequest(request: IncomingMessage): Promise<LauncherCallbackResult> {
        if (request.method !== "POST")
            throw new UserFacingError("The launcher callback used an invalid HTTP method.");

        const callbackUrl = new URL(request.url ?? "", `http://${GameLauncherService.CALLBACK_HOST}:${GameLauncherService.CALLBACK_PORT}`);
        if (callbackUrl.pathname !== GameLauncherService.CALLBACK_PATH)
            throw new UserFacingError("The launcher callback used an invalid path.");

        const body = await this.readCallbackBody(request);
        if (!TypeCheck.isRecord(body))
            throw new UserFacingError("The launcher callback body is invalid.");

        const queryStatus = callbackUrl.searchParams.get("status");
        const bodyStatus = body.status;

        if (
            !TypeCheck.isValidString(queryStatus, 20) ||
            !TypeCheck.isValidString(bodyStatus, 20) ||
            queryStatus !== bodyStatus ||
            (queryStatus !== "started" && queryStatus !== "failed")
        )
        {
            throw new UserFacingError("The launcher returned an invalid status.");
        }

        if (queryStatus === "started")
            return { status: "started" };

        const queryReason = callbackUrl.searchParams.get("reason");
        const bodyReason = body.reason;

        if (
            !TypeCheck.isValidString(queryReason, 64) ||
            !TypeCheck.isValidString(bodyReason, 64) ||
            queryReason !== bodyReason ||
            !this.isFailureReason(queryReason)
        )
        {
            throw new UserFacingError("The launcher returned an invalid failure reason.");
        }

        return {
            status: "failed",
            reason: queryReason
        };
    }

    private async readCallbackBody(request: IncomingMessage): Promise<unknown> {
        const contentType = request.headers["content-type"] ?? "";

        if (!contentType.toLocaleLowerCase("en-US").includes("application/json"))
            throw new UserFacingError("The launcher callback did not contain JSON.");

        const chunks: Buffer[] = [];
        let totalSize = 0;

        for await (const chunk of request)
        {
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);

            totalSize += buffer.length;

            if (totalSize > GameLauncherService.MAXIMUM_CALLBACK_BODY_SIZE)
                throw new UserFacingError("The launcher callback body was unexpectedly large.");

            chunks.push(buffer);
        }

        if (totalSize === 0)
            throw new UserFacingError("The launcher callback body was empty.");

        try
        {
            return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        }
        catch (error)
        {
            throw new UserFacingError("The launcher callback body was not valid JSON.", { cause: error });
        }
    }

    private listen(server: Server) {
        return new Promise<void>((resolve, reject) => {
            const handleError = (error: Error) => {
                server.off("listening", handleListening);
                reject(error);
            };

            const handleListening = () => {
                server.off("error", handleError);
                resolve();
            };

            server.once("error", handleError);
            server.once("listening", handleListening);

            server.listen(GameLauncherService.CALLBACK_PORT, GameLauncherService.CALLBACK_HOST);
        });
    }

    private parseRequest(rawRequest: unknown): GameLaunchRequest {
        if (!TypeCheck.isRecord(rawRequest) || !TypeCheck.isBoolean(rawRequest.vanilla))
            throw new UserFacingError("The game launch request is invalid.");

        return {
            vanilla: rawRequest.vanilla
        };
    }

    private getFailureReasonMessage(reason: LauncherFailureReason): string {
        switch (reason)
        {
            case "launcher_update_required":
                return "LOLauncher must be updated before the game can start.";
            case "game_not_installed":
                return "The game is not installed.";
            case "game_update_required":
                return "The game must be updated before it can start.";
            case "service_unavailable":
                return "The game service is currently unavailable.";
            case "maintenance":
                return "The game is currently undergoing maintenance.";
            case "login_canceled":
                return "The launcher login was canceled.";
            case "game_already_running":
                return "The game is already running.";
            case "launch_canceled":
                return "The game launch was canceled.";
            case "launch_failed":
                return "The launcher could not start the game";
        }
    }

    private createLauncherRequirementResult(requirement: GameLauncherRequirement): GameLaunchResult {
        return {
            status: "launcher-required",
            requirement,
            minimumVersion: GameLauncherService.MINIMUM_LAUNCHER_VERSION
        };
    }

    private isFailureReason(value: string): value is LauncherFailureReason {
        return (LAUNCHER_FAILURE_REASONS as readonly string[]).includes(value);
    }
}
