import { ModRepository } from "#database/repositories/ModRepository.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export class ModAssetProtocol {
    private static readonly modRepository = new ModRepository();
    private static handlerRegistered = false;
    static readonly SCHEME = "lorplus-mod-asset";

    static registerHandler() {
        if (ModAssetProtocol.handlerRegistered)
            return;

        protocol.handle(ModAssetProtocol.SCHEME, async (request) => {
            try
            {
                if (request.method !== "GET")
                {
                    return new Response(null, {
                        status: 405,
                        headers: {
                            Allow: "GET"
                        }
                    });
                }

                const url = new URL(request.url);
                if (url.hostname !== "mod" || url.search || url.hash)
                    return new Response(null, { status: 400 });

                const pathMatch = /^\/([^/]+)\/([^/]+)$/.exec(url.pathname);
                if (!pathMatch)
                    return new Response(null, { status: 400 });

                const modId = decodeURIComponent(pathMatch[1]);
                const requestedAssetName = decodeURIComponent(pathMatch[2]);

                if (!TypeCheck.isUuid(modId) || !Paths.isSafeModAssetName(requestedAssetName))
                    return new Response(null, { status: 400 });

                const location = ModAssetProtocol.modRepository.getAssetLocation(modId, requestedAssetName);

                if (!location)
                    return new Response(null, { status: 404 });
                if (!Paths.isSafeModDirectoryName(location.directoryName) || !Paths.isSafeModAssetName(location.assetName))
                    throw new Error("The stored mod asset location is invalid.");

                const configuredModsRoot = Paths.getModsPath();
                const configuredModDirectory = path.join(configuredModsRoot, location.directoryName);
                const modsRoot = await fse.realpath(configuredModsRoot);
                const modDirectory = await fse.realpath(configuredModDirectory);

                if (!Paths.isSubpath(modsRoot, modDirectory))
                    return new Response(null, { status: 404 });

                const configuredAssetPath = path.join(modDirectory, location.assetName);
                const assetPath = await fse.realpath(configuredAssetPath);

                if (!Paths.isSubpath(modDirectory, assetPath))
                    return new Response(null, { status: 404 });

                const stats = await fse.stat(assetPath);
                if (!stats.isFile())
                    return new Response(null, { status: 404 });

                return net.fetch(pathToFileURL(assetPath).toString());
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && ["ENOENT", "ENOTDIR"].includes(error.code ?? ""))
                    return new Response(null, { status: 404 });

                ApplicationLogger.error(ApplicationLogSource.modLibrary, "Could not serve an imported mod asset.", error);
                return new Response(null, { status: 500 });
            }
        });

        ModAssetProtocol.handlerRegistered = true;
    }
}
