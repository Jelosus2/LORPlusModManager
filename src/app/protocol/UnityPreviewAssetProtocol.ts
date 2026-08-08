import { UnityPreviewAssetCacheService } from "#mod/UnityPreviewAssetCacheService.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export class UnityPreviewAssetProtocol {
    private static handlerRegistered = false;
    static readonly SCHEME = "lorplus-preview-asset";

    static registerHandler(): void {
        if (UnityPreviewAssetProtocol.handlerRegistered)
            return;

        protocol.handle(UnityPreviewAssetProtocol.SCHEME, async (request) => {
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
                if (url.hostname !== "cache" || url.search || url.hash)
                    return new Response(null, { status: 400 });

                const match = /^\/([^/]+)\/([^/]+)\/([0-9a-f]{64})\.png$/i.exec(url.pathname);
                if (!match)
                    return new Response(null, { status: 400 });

                const bundleName = decodeURIComponent(match[1]);
                const versionHash = decodeURIComponent(match[2]);
                const cacheKey = decodeURIComponent(match[3]);

                if (
                    !Paths.isSafeGameAssetBundleName(bundleName) ||
                    !Paths.isSafeGameAssetBundleVersionHash(versionHash) ||
                    !/^[0-9a-f]{64}$/i.test(cacheKey)
                )
                {
                    return new Response(null, { status: 400 });
                }

                const configuredBundleRoot = Paths.getUnityPreviewBundleCachePath(bundleName, versionHash);
                const configuredEntryPath = path.join(configuredBundleRoot, cacheKey);
                const bundleRoot = await fse.realpath(configuredBundleRoot);
                const entryPath = await fse.realpath(configuredEntryPath);

                if (!Paths.isSubpath(bundleRoot, entryPath))
                    return new Response(null, { status: 404 });

                const entryStats = await fse.stat(entryPath);
                if (!entryStats.isDirectory())
                    return new Response(null, { status: 404 });

                const assetPath = await fse.realpath(path.join(entryPath, "asset.png"));
                if (!Paths.isSubpath(entryPath, assetPath))
                    return new Response(null, { status: 404 });

                const assetStats = await fse.stat(assetPath);

                if (!assetStats.isFile() || assetStats.size === 0 || assetStats.size > UnityPreviewAssetCacheService.MAXIMUM_IMAGE_SIZE)
                    return new Response(null, { status: 404 });

                return net.fetch(pathToFileURL(assetPath).toString());
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && ["ENOENT", "ENOTDIR"].includes(error.code ?? ""))
                    return new Response(null, { status: 404 });

                ApplicationLogger.error(ApplicationLogSource.modLibrary, "Could not serve a cached Unity preview asset.", error);
                return new Response(null, { status: 500 });
            }
        });

        UnityPreviewAssetProtocol.handlerRegistered = true;
    }
}
