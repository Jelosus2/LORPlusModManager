import type { CharacterCatalog, CharacterSkin } from "../../shared/characters";

import { computed, ref, shallowRef } from "vue";
import { ErrorUtils } from "@/utils/ErrorUtils";
import { defineStore } from "pinia";

const EMPTY_CHARACTERS: readonly CharacterSkin[] = Object.freeze([]);

export const useCharacterCatalogStore = defineStore("character-catalog", () => {
    const catalog = shallowRef<CharacterCatalog | null>(null);
    const isLoading = ref(false);
    const errorMessage = ref("");

    let pendingLoad: Promise<boolean> | null = null;

    const skins = computed<readonly CharacterSkin[]>(() => catalog.value?.characters ?? EMPTY_CHARACTERS);
    const skinsByCharacterName = computed(() => {
        const groups = new Map<string, CharacterSkin[]>();

        for (const skin of skins.value)
        {
            const existing = groups.get(skin.characterName);

            if (existing)
                existing.push(skin)
            else
                groups.set(skin.characterName, [skin]);
        }

        return groups as ReadonlyMap<string, readonly CharacterSkin[]>;
    });

    async function load(force = false): Promise<boolean> {
        if (catalog.value && !force)
            return true;
        if (pendingLoad)
            return pendingLoad;

        pendingLoad = (async () => {
            isLoading.value = true;
            errorMessage.value = "";

            try
            {
                catalog.value = await window.app.getCharacterCatalog();
                return true;
            }
            catch (error)
            {
                console.error("Failed to load the character catalog:", error);

                errorMessage.value = ErrorUtils.getUserErrorMessage(error, "Could not load the character information.");
                return false;
            }
            finally
            {
                isLoading.value = false;
            }
        })();

        try
        {
            return await pendingLoad;
        }
        finally
        {
            pendingLoad = null;
        }
    }

    return {
        catalog,
        skins,
        skinsByCharacterName,
        isLoading,
        errorMessage,
        load
    };
});
