import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { CatalogIconService } from "#update/CatalogIconService.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { Paths } from "#utils/Paths.js";
import fse from "fs-extra";

export class CatalogIconProtocol {
    private static handlerRegistered = false;
    static readonly SCHEME = "lorplus-catalog-icon";

    static registerHandler() {
        if (CatalogIconProtocol.handlerRegistered)
            return;

        protocol.handle(CatalogIconProtocol.SCHEME, async (request) => {
            try
            {
                const url = new URL(request.url);
                if (url.hostname !== "catalog" || url.search || url.hash)
                    return new Response(null, { status: 400 });

                const iconFile = decodeURIComponent(url.pathname.slice(1));
                if (!Paths.isSafeCatalogIconName(iconFile))
                    return new Response(null, { status: 400 });

                const iconPath = Paths.getCachedCharacterIconPath(iconFile);
                const stats = await fse.stat(iconPath);

                if (!stats.isFile() || stats.size > CatalogIconService.MAX_CATALOG_ICON_SIZE)
                    return new Response(null, { status: 404 });

                return net.fetch(pathToFileURL(iconPath).toString());
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    return new Response(null, { status: 404 });

                ApplicationLogger.error(ApplicationLogSource.catalog, "Could not serve a cached character icon.", error);
                return new Response(null, { status: 500 });
            }
        });

        CatalogIconProtocol.handlerRegistered = true;
    }
}
