import type { InstalledMod } from "../../shared/mod";

import { computed, reactive, ref, shallowRef } from "vue";
import { StringUtils } from "@/utils/StringUtils";
import { defineStore } from "pinia";

const EMPTY_MODS: readonly InstalledMod[] = Object.freeze([]);

export function createCatalogIdentity(skin2dId: string, variantId: string | null): string {
    return [
        StringUtils.normalize(skin2dId),
        variantId ?
            StringUtils.normalize(variantId)
            : ""
    ].join("\u0000");
}

export const useModStore = defineStore("mods", () => {
    const mods = shallowRef<readonly InstalledMod[]>(EMPTY_MODS);
    const isLoading = ref(false);
    const errorMessage = ref("");
    const hasLoaded = ref(false);
    const updatingModIds = reactive(new Set<string>());
    const updateErrorMessage = ref("");

    let pendingLoad: Promise<boolean> | null = null;

    const modsByCatalogIdentity = computed(() => {
        const index = new Map<string, InstalledMod[]>();

        for (const mod of mods.value)
        {
            const key = createCatalogIdentity(mod.skin2dId, mod.variantId);
            const existing = index.get(key);

            if (existing)
                existing.push(mod);
            else
                index.set(key, [mod]);
        }

        return index as ReadonlyMap<string, readonly InstalledMod[]>;
    });

    function getModsForSkin(skin2dId: string, variantId: string | null): readonly InstalledMod[] {
        const key = createCatalogIdentity(skin2dId, variantId);
        return modsByCatalogIdentity.value.get(key) ?? EMPTY_MODS;
    }

    async function setEnabled(modId: string, enabled: boolean): Promise<boolean> {
        if (updatingModIds.has(modId))
            return false;

        const currentMod = mods.value.find((mod) => mod.id === modId);
        if (!currentMod || currentMod.enabled === enabled)
            return Boolean(currentMod);

        const previousEnabled = currentMod.enabled;

        updatingModIds.add(modId);
        updateErrorMessage.value = "";

        mods.value = mods.value.map((mod) =>
            mod.id === modId
                ? { ...mod, enabled }
                : mod
        );

        try
        {
            await window.app.setModEnabled(modId, enabled);
            return true;
        }
        catch (error)
        {
            console.error("Failed to update the mod enabled state:", error);

            mods.value = mods.value.map((mod) =>
                mod.id === modId && mod.enabled === enabled
                    ? { ...mod, enabled: previousEnabled }
                    : mod
            );

            updateErrorMessage.value = "The mod selection could not be saved.";
            return false;
        }
        finally
        {
            updatingModIds.delete(modId);
        }
    }

    async function load(force = false): Promise<boolean> {
        if (hasLoaded.value && !force)
            return true;
        if (pendingLoad)
            return pendingLoad;

        pendingLoad = (async () => {
            isLoading.value = true;
            errorMessage.value = "";

            try
            {
                mods.value = await window.app.getMods();
                hasLoaded.value = true;
                return true;
            }
            catch (error)
            {
                console.error("Failed to load installed mods:", error);

                errorMessage.value = "Could not load the installed mods.";
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
        mods,
        isLoading,
        errorMessage,
        updatingModIds,
        updateErrorMessage,
        modsByCatalogIdentity,
        getModsForSkin,
        setEnabled,
        load
    };
});
