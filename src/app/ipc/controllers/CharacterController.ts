import type { CharacterCatalog } from "../../../shared/characters.js";

import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class CharacterController {
    @IpcHelper.IpcHandle("characters:get-catalog")
    async getCatalog(): Promise<CharacterCatalog> {
        return characterCatalog.getCatalog();
    }
}
