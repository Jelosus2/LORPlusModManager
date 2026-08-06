import { CatalogIconProtocol } from "./CatalogIconProtocol.js";
import { ModAssetProtocol } from "./ModAssetProtocol.js";
import { protocol } from "electron";

export class ProtocolRegistry {
    private static schemesRegistered = false;

    static registerSchemes() {
        if (this.schemesRegistered)
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
            }
        ]);
    }

    static registerHandlers() {
        CatalogIconProtocol.registerHandler();
        ModAssetProtocol.registerHandler();
    }
}
