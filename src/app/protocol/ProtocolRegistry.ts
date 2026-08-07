import { CatalogBackgroundProtocol } from "./CatalogBackgroundProtocol.js";
import { CatalogIconProtocol } from "./CatalogIconProtocol.js";
import { ModAssetProtocol } from "./ModAssetProtocol.js";
import { protocol } from "electron";

export class ProtocolRegistry {
    private static schemesRegistered = false;

    static registerSchemes() {
        if (ProtocolRegistry.schemesRegistered)
            return;

        protocol.registerSchemesAsPrivileged([
            {
                scheme: CatalogIconProtocol.SCHEME,
                privileges: {
                    standard: true,
                    secure: true,
                    supportFetchAPI: true,
                    corsEnabled: true
                }
            },
            {
                scheme: ModAssetProtocol.SCHEME,
                privileges: {
                    standard: true,
                    secure: true,
                    supportFetchAPI: true,
                    corsEnabled: true
                }
            },
            {
                scheme: CatalogBackgroundProtocol.SCHEME,
                privileges: {
                    standard: true,
                    secure: true,
                    supportFetchAPI: true,
                    corsEnabled: true
                }
            }
        ]);

        ProtocolRegistry.schemesRegistered = true;
    }

    static registerHandlers() {
        CatalogIconProtocol.registerHandler();
        ModAssetProtocol.registerHandler();
        CatalogBackgroundProtocol.registerHandler();
    }
}
