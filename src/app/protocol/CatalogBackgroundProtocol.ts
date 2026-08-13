import { CatalogBackgroundService } from "#update/CatalogBackgroundService.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { LocalFileResponse } from "./LocalFileResponse.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import { protocol } from "electron";
import fse from "fs-extra";

export class CatalogBackgroundProtocol {
    private static handlerRegistered = false;
    static readonly SCHEME = "lorplus-catalog-background";

    static registerHandler() {
        if (CatalogBackgroundProtocol.handlerRegistered)
            return;

        protocol.handle(CatalogBackgroundProtocol.SCHEME, async (request) => {
            try
            {
                const url = new URL(request.url);
                if (url.hostname !== "catalog" || url.search || url.hash)
                    return new Response(null, { status: 400 });

                const fileName = decodeURIComponent(url.pathname.slice(1));
                if (!Paths.isSafeCatalogBackgroundName(fileName))
                    return new Response(null, { status: 400 });

                const filePath = Paths.getCachedSkinBackgroundPath(fileName);
                const stats = await fse.stat(filePath);

                if (!stats.isFile() || stats.size === 0 || stats.size > CatalogBackgroundService.MAX_CATALOG_BACKGROUND_SIZE)
                    return new Response(null, { status: 404 });

                return LocalFileResponse.create(filePath, {
                    size: stats.size,
                    contentType: "image/webp",
                    cacheControl: "no-cache"
                });
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    return new Response(null, { status: 404 });

                ApplicationLogger.error(ApplicationLogSource.catalog, "Could not serve a cached skin background.", error);
                return new Response(null, { status: 500 });
            }
        });

        CatalogBackgroundProtocol.handlerRegistered = true;
    }
}
