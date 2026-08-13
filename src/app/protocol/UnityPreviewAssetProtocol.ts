import { UnityPreviewAssetCacheService, unityPreviewAssetCache } from "#mod/UnityPreviewAssetCacheService.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { LocalFileResponse } from "./LocalFileResponse.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import { protocol } from "electron";
import path from "node:path";
import fse from "fs-extra";

export class UnityPreviewAssetProtocol {
    private static handlerRegistered = false;
    static readonly SCHEME = "lorplus-preview-asset";

    static registerHandler() {
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
                if (url.search || url.hash)
                    return new Response(null, { status: 400 });

                if (url.hostname === "cache")
                    return await this.serveCachedImage(url);
                if (url.hostname === "runtime")
                    return await this.serveAnimatorRuntimeFile(url);

                return new Response(null, { status: 400 });
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

    private static async serveCachedImage(url: URL): Promise<Response> {
        const match = /^\/([^/]+)\/([^/]+)\/([0-9a-f]{64})\.png$/i.exec(url.pathname);
        if (!match)
            return new Response(null, { status: 400 });

        let bundleName: string;
        let versionHash: string;

        try
        {
            bundleName = decodeURIComponent(match[1]);
            versionHash = decodeURIComponent(match[2]);
        }
        catch
        {
            return new Response(null, { status: 400 });
        }

        const cacheKey = match[3];

        if (!Paths.isSafeGameAssetBundleName(bundleName) || !Paths.isSafeGameAssetBundleVersionHash(versionHash))
            return new Response(null, { status: 400 });

        const configuredBundleRoot = Paths.getUnityPreviewBundleCachePath(bundleName, versionHash);
        const configuredEntryPath = path.join(configuredBundleRoot, cacheKey);
        const configuredEntryStats = await fse.lstat(configuredEntryPath);

        if (!configuredEntryStats.isDirectory() || configuredEntryStats.isSymbolicLink())
            return new Response(null, { status: 404 });

        const bundleRoot = await fse.realpath(configuredBundleRoot);
        const entryPath = await fse.realpath(configuredEntryPath);

        if (!Paths.isSubpath(bundleRoot, entryPath))
            return new Response(null, { status: 404 });

        const configuredAssetPath = path.join(entryPath, "asset.png");
        const configuredAssetStats = await fse.lstat(configuredAssetPath);

        if (!configuredAssetStats.isFile() || configuredAssetStats.isSymbolicLink())
            return new Response(null, { status: 404 });

        const assetPath = await fse.realpath(configuredAssetPath);
        if (!Paths.isSubpath(entryPath, assetPath))
            return new Response(null, { status: 404 });

        const assetStats = await fse.stat(assetPath);

        if (!assetStats.isFile() || assetStats.size === 0 || assetStats.size > UnityPreviewAssetCacheService.MAXIMUM_IMAGE_SIZE)
            return new Response(null, { status: 404 });

        return LocalFileResponse.create(assetPath, {
            size: assetStats.size,
            contentType: "image/png",
            cacheControl: "public, max-age=31536000, immutable",
            etag: cacheKey
        });
    }

    private static async serveAnimatorRuntimeFile(url: URL): Promise<Response> {
        const match = /^\/([^/]+)\/([^/]+)\/([0-9a-f]{64})\/(.+)$/i.exec(url.pathname);
        if (!match)
            return new Response(null, { status: 400 });

        let bundleName: string;
        let versionHash: string;
        let relativePath: string;

        try
        {
            bundleName = decodeURIComponent(match[1]);
            versionHash = decodeURIComponent(match[2]);

            const segments = match[4].split("/").map((segment) => decodeURIComponent(segment));

            if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")))
                return new Response(null, { status: 400 });

            relativePath = segments.join("/");
        }
        catch
        {
            return new Response(null, { status: 400 });
        }

        const cacheKey = match[3];
        const resolved = await unityPreviewAssetCache.resolveAnimatorRuntimeFile(bundleName, versionHash, cacheKey, relativePath);

        if (!resolved)
            return new Response(null, { status: 404 });

        return LocalFileResponse.create(resolved.filePath, {
            size: resolved.size,
            contentType: this.getRuntimeContentType(relativePath),
            cacheControl: "public, max-age=31536000, immutable",
            etag: resolved.sha256
        });
    }

    private static getRuntimeContentType(relativePath: string): string {
        if (relativePath === "runtime.json")
            return "application/json; charset=utf-8";
        if (relativePath.endsWith(".png"))
            return "image/png";

        return "application/octet-stream";
    }
}
