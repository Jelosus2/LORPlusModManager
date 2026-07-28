<script setup lang="ts">
import type { CharacterSkin } from "../../shared/characters";
import type { InstalledMod } from "../../shared/mod";

import RefreshIcon from "./icons/RefreshIcon.vue";
import SearchIcon from "./icons/SearchIcon.vue";
import FolderIcon from "./icons/FolderIcon.vue";
import RenameIcon from "./icons/RenameIcon.vue";
import CheckIcon from "./icons/CheckIcon.vue";
import TrashIcon from "./icons/TrashIcon.vue";
import ModWarning from "./ModWarning.vue";

import { useCharacterCatalogStore } from "@/stores/characterCatalogStore";
import { useModStore, createCatalogIdentity } from "@/stores/modStore";
import { getCharacterIconUrl } from "@/data/characterIcons";
import { StringUtils } from "@/utils/StringUtils";
import { computed, ref, watch, nextTick } from "vue";

type ModType = "normal" | "damaged";
type SkinType = "spine" | "animator" | "static" | "unknown";

type ModTypeFilter = "all" | ModType;
type SkinTypeFilter = "all" | Exclude<SkinType, "unknown">;

type SortKey =
    | "directoryName"
    | "modType"
    | "skinType"
    | "character"
    | "importedAt";

type SortDirection = "ascending" | "descending";

type ModTableRow = {
    mod: InstalledMod;
    catalogSkin: CharacterSkin | null;
    modType: ModType;
    skinType: SkinType;
    characterLabel: string;
    normalizedDirectoryName: string;
    normalizedCharacterLabel: string;
    iconUrl: string | null;
    importedTimestamp: number;
};

type BulkDeleteSummary = Readonly<{
    requestedCount: number;
    deletedCount: number;
    failures: readonly Readonly<{
        directoryName: string;
        message: string;
    }>[];
    requestError: string;
}>;

const PAGE_SIZE = 100;
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const catalogStore = useCharacterCatalogStore();
const modStore = useModStore();

const modNameFilter = ref("");
const characterFilter = ref("");
const modTypeFilter = ref<ModTypeFilter>("all");
const skinTypeFilter = ref<SkinTypeFilter>("all");
const importedFrom = ref("");
const importedTo = ref("");
const sortKey = ref<SortKey>("directoryName");
const sortDirection = ref<SortDirection>("ascending");
const currentPage = ref(1);
const selectedModIds = ref(new Set<string>());
const isRefreshing = ref(false);
const refreshErrorMessage = ref("");
const deleteDialog = ref<HTMLDialogElement | null>(null);
const modPendingDeletion = ref<InstalledMod | null>(null);
const isDeletingMod = ref(false);
const actionErrorMessage = ref("");
const renameDialog = ref<HTMLDialogElement | null>(null);
const modPendingRename = ref<InstalledMod | null>(null);
const renameDirectoryName = ref("");
const renameErrorMessage = ref("");
const isRenamingMod = ref(false);
const isBulkDeleteMode = ref(false);
const bulkDeleteModIds = ref(new Set<string>());
const bulkDeleteResultDialog = ref<HTMLDialogElement | null>(null);
const bulkDeleteSummary = ref<BulkDeleteSummary | null>(null);
const isBulkDeleting = ref(false);

let knownModIds = new Set<string>();

const catalogIndex = computed(() => {
    const index = new Map<string, CharacterSkin>();

    for (const skin of catalogStore.skins)
        index.set(createCatalogIdentity(skin.skin2dId, skin.variantId), skin);

    return index;
});

const rows = computed<ModTableRow[]>(() =>
    modStore.mods.map((mod) => {
        const catalogSkin = catalogIndex.value.get(createCatalogIdentity(mod.skin2dId, mod.variantId)) ?? null;
        const characterLabel = catalogSkin
            ? `${catalogSkin.characterName}: ${catalogSkin.skinName}`
            : "Unknown character";

        return {
            mod,
            catalogSkin,
            modType: getModType(mod),
            skinType: getSkinType(catalogSkin),
            characterLabel,
            normalizedDirectoryName: StringUtils.normalize(mod.directoryName),
            normalizedCharacterLabel: StringUtils.normalize(characterLabel),
            iconUrl: catalogSkin
                ? getCharacterIconUrl(catalogSkin.iconFile) ?? null
                : null,
            importedTimestamp: new Date(mod.importedAt).getTime()
        };
    })
);

const conflictMessages = computed(() => {
    const groups = new Map<string, ModTableRow[]>();
    const messages = new Map<string, string>();

    for (const row of rows.value)
    {
        if (!selectedModIds.value.has(row.mod.id) || row.mod.verification.status !== "valid")
            continue;

            const key = [
                createCatalogIdentity(row.mod.skin2dId, row.mod.variantId),
                row.modType
            ].join("\u0001");

            const existing = groups.get(key);

            if (existing)
                existing.push(row);
            else
                groups.set(key, [row]);
    }

    for (const group of groups.values())
    {
        if (group.length < 2)
            continue;

        for (const row of group)
        {
            const otherMods = group
                .filter((entry) => entry.mod.id !== row.mod.id)
                .map((entry) => `"${entry.mod.directoryName}"`);

            messages.set(
                row.mod.id,
                `${otherMods.join(", ")} ${
                    otherMods.length === 1 ? "is" : "are"
                } also enabled. These mods target the same ${
                    row.modType
                } appearance for ${row.characterLabel}. Only one can be synchronized at a time.`
            );
        }
    }

    return messages;
});

const filteredRows = computed(() => {
    const normalizedModName = StringUtils.normalize(modNameFilter.value);
    const normalizedCharacter = StringUtils.normalize(characterFilter.value);

    const fromTimestamp = importedFrom.value
        ? new Date(`${importedFrom.value}T00:00:00`).getTime()
        : null;

    const toTimestamp = importedTo.value
        ? new Date(`${importedTo.value}T23:59:59.999`).getTime()
        : null;

    return rows.value.filter((row) => {
        if (normalizedModName && !row.normalizedDirectoryName.includes(normalizedModName))
            return false;

        if (normalizedCharacter && !row.normalizedCharacterLabel.includes(normalizedCharacter))
            return false;

        if (modTypeFilter.value !== "all" && row.modType !== modTypeFilter.value)
            return false;

        if (skinTypeFilter.value !== "all" && row.skinType !== skinTypeFilter.value)
            return false;

        if (fromTimestamp !== null && row.importedTimestamp < fromTimestamp)
            return false;

        if (toTimestamp !== null && row.importedTimestamp > toTimestamp)
            return false;

        return true;
    });
});

const sortedRows = computed(() => {
    const result = [...filteredRows.value];

    result.sort((left, right) => {
        let comparison = 0;

        switch (sortKey.value)
        {
            case "directoryName":
                comparison = collator.compare(left.mod.directoryName, right.mod.directoryName);
                break;
            case "modType":
                comparison = collator.compare(left.modType, right.modType);
                break;
            case "skinType":
                comparison = collator.compare(left.skinType, right.skinType);
                break;
            case "character":
                comparison = collator.compare(left.characterLabel, right.characterLabel);
                break;
            case "importedAt":
                comparison = left.importedTimestamp - right.importedTimestamp;
                break;
        }

        if (comparison === 0)
            comparison = collator.compare(left.mod.directoryName, right.mod.directoryName);

        return sortDirection.value === "ascending"
            ? comparison
            : -comparison;
    });

    return result;
});

const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / PAGE_SIZE)));

const visibleRows = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return sortedRows.value.slice(start, start + PAGE_SIZE);
});

const firstVisibleResult = computed(() =>
    sortedRows.value.length > 0
        ? (currentPage.value - 1) * PAGE_SIZE + 1
        : 0
);

const lastVisibleResult = computed(() => Math.min(currentPage.value * PAGE_SIZE, sortedRows.value.length));

const hasActiveFilters = computed(() =>
    Boolean(
        modNameFilter.value ||
        characterFilter.value ||
        modTypeFilter.value !== "all" ||
        skinTypeFilter.value !== "all" ||
        importedFrom.value ||
        importedTo.value
    )
);

const isLoading = computed(() => catalogStore.isLoading || (modStore.isLoading && modStore.mods.length === 0));
const loadErrorMessage = computed(() =>
    catalogStore.errorMessage ||
    (
        modStore.mods.length === 0
            ? modStore.errorMessage
            : ""
    )
);

const invalidModCount = computed(() => modStore.mods.filter((mod) => mod.verification.status !== "valid").length);
const bulkDeleteSelectionCount = computed(() => bulkDeleteModIds.value.size);

watch([modNameFilter, characterFilter, modTypeFilter, skinTypeFilter, importedFrom, importedTo], () => {
    currentPage.value = 1;
});

watch(() => modStore.mods, (mods) => {
    const currentModIds = new Set(mods.map((mod) => mod.id));
    const nextSelection = new Set([...selectedModIds.value].filter((id) => currentModIds.has(id)));

    for (const mod of mods)
    {
        if (mod.verification.status !== "valid")
        {
            nextSelection.delete(mod.id);
            continue;
        }

        if (!knownModIds.has(mod.id) && mod.enabled)
            nextSelection.add(mod.id);
    }

    bulkDeleteModIds.value = new Set([...bulkDeleteModIds.value].filter((id) => currentModIds.has(id)));
    if (mods.length === 0)
        isBulkDeleteMode.value = false;

    selectedModIds.value = nextSelection;
    knownModIds = currentModIds;
}, { immediate: true });

watch(totalPages, (pageCount) => {
    if (currentPage.value > pageCount)
        currentPage.value = pageCount;
});

async function refreshMods() {
    if (isRefreshing.value)
        return;

    isRefreshing.value = true;
    refreshErrorMessage.value = "";

    try
    {
        const refreshed = await modStore.load(true);
        if (!refreshed)
            refreshErrorMessage.value = "The mods could not be refreshed.";
    }
    finally
    {
        isRefreshing.value = false;
    }
}

async function openModFolder(mod: InstalledMod) {
    actionErrorMessage.value = "";

    try
    {
        await window.app.openModFolder(mod.id);
    }
    catch (error)
    {
        console.error("Could not open the mod folder:", error);
        actionErrorMessage.value =  "The mod folder could not be opened. Refresh the list and try again.";
    }
}

async function requestModDeletion(mod: InstalledMod) {
    modPendingDeletion.value = mod;
    actionErrorMessage.value = "";

    await nextTick();
    deleteDialog.value?.showModal();
}

async function confirmModDeletion() {
    const mod = modPendingDeletion.value;
    if (!mod || isDeletingMod.value)
        return;

    isDeletingMod.value = true;
    actionErrorMessage.value = "";

    try
    {
        await window.app.deleteMod(mod.id);

        const nextSelection = new Set(selectedModIds.value);
        nextSelection.delete(mod.id);
        selectedModIds.value = nextSelection;

        deleteDialog.value?.close();
        modPendingDeletion.value = null;

        const refreshed = await modStore.load(true);
        if (!refreshed)
            actionErrorMessage.value = "The mod was deleted, but the list could not be refreshed.";
    }
    catch (error)
    {
        console.error("Could not delete the mod:", error);
        actionErrorMessage.value = "The mod could not be deleted. Its files and library entry were left unchanged.";
    }
    finally
    {
        isDeletingMod.value = false;
    }
}

async function requestModRename(mod: InstalledMod) {
    modPendingRename.value = mod;
    renameDirectoryName.value = mod.directoryName;
    renameErrorMessage.value = "";
    actionErrorMessage.value = "";

    await nextTick();
    renameDialog.value?.showModal();
}

async function confirmModRename() {
    const mod = modPendingRename.value;
    const directoryName = renameDirectoryName.value.trim();

    if (!mod || isRenamingMod.value)
        return;

    if (!directoryName)
    {
        renameErrorMessage.value = "Enter a name for the mod.";
        return;
    }

    if (directoryName === mod.directoryName)
    {
        cancelModRename();
        return;
    }

    isRenamingMod.value = true;
    renameErrorMessage.value = "";
    actionErrorMessage.value = "";

    try
    {
        await window.app.renameMod({ modId: mod.id, directoryName });

        renameDialog.value?.close();
        modPendingRename.value = null;
        renameDirectoryName.value = "";

        const refreshed = await modStore.load(true);
        if (!refreshed)
            actionErrorMessage.value = "The mod was renamed, but the list could not be refreshed.";
    }
    catch (error)
    {
        console.error("Could not rename the mod:", error);
        renameErrorMessage.value = "The mod could not be renamed. Another mod or folder may already use that name.";
    }
    finally
    {
        isRenamingMod.value = false;
    }
}

function requestBulkDeletion() {
    isBulkDeleteMode.value = true;
    bulkDeleteModIds.value = new Set();
    bulkDeleteSummary.value = null;
    actionErrorMessage.value = "";
}

async function confirmBulkDeletion() {
    if (bulkDeleteModIds.value.size === 0 || isBulkDeleting.value)
        return;

    const requestedModIds = [...bulkDeleteModIds.value];
    const namesById = new Map(modStore.mods.map((mod) => [mod.id, mod.directoryName]));

    isBulkDeleting.value = true;
    bulkDeleteSummary.value = null;
    actionErrorMessage.value = "";

    try
    {
        const result = await window.app.deleteMods(requestedModIds);

        const nextSyncSelection = new Set(selectedModIds.value);

        for (const modId of result.deletedModIds)
            nextSyncSelection.delete(modId);

        selectedModIds.value = nextSyncSelection;

        bulkDeleteSummary.value = {
            requestedCount: requestedModIds.length,
            deletedCount: result.deletedModIds.length,
            failures: result.failures.map((failure) => ({
                directoryName: namesById.get(failure.modId) ?? "Unknown mod",
                message: failure.message
            })),
            requestError: ""
        };

        isBulkDeleteMode.value = false;
        bulkDeleteModIds.value = new Set();

        const refreshed = await modStore.load(true);

        if (!refreshed)
            actionErrorMessage.value = "The mods were processed, but the list could not be refreshed.";

        await nextTick();
        bulkDeleteResultDialog.value?.showModal();
    }
    catch (error)
    {
        console.error("Could not delete the selected mods:", error);

        bulkDeleteSummary.value = {
            requestedCount: requestedModIds.length,
            deletedCount: 0,
            failures: [],
            requestError: "The selected mods could not be deleted."
        };

        await nextTick();
        bulkDeleteResultDialog.value?.showModal();
    }
    finally
    {
        isBulkDeleting.value = false;
    }
}

function getModType(mod: InstalledMod): ModType {
    return StringUtils.normalize(mod.skin2dId).endsWith("_dam")
        ? "damaged"
        : "normal";
}

function getSkinType(skin: CharacterSkin | null): SkinType {
    if (!skin)
        return "unknown";
    if (skin.isSpineSkin)
        return "spine";
    if (skin.isAnimatorSkin)
        return "animator";
    if (skin.isStaticSkin)
        return "static";

    return "unknown";
}

function formatLabel(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatImportDate(row: ModTableRow): string {
    return Number.isFinite(row.importedTimestamp)
        ? dateFormatter.format(row.importedTimestamp)
        : "Unknown";
}

function setSort(key: SortKey) {
    if (sortKey.value === key)
    {
        sortDirection.value = sortDirection.value === "ascending"
            ? "descending"
            : "ascending";

        return;
    }

    sortKey.value = key;
    sortDirection.value = key === "importedAt"
        ? "descending"
        : "ascending";
}

function sortState(key: SortKey): SortDirection | "none" {
    return sortKey.value === key
        ? sortDirection.value
        : "none";
}

function toggleMod(modId: string, event: Event) {
    const checkbox = event.currentTarget as HTMLInputElement;
    const nextSelection = new Set(selectedModIds.value);

    if (checkbox.checked)
        nextSelection.add(modId);
    else
        nextSelection.delete(modId);

    selectedModIds.value = nextSelection;
}

function toggleBulkDeleteMod(modId: string) {
    const nextSelection = new Set(bulkDeleteModIds.value);

    if (nextSelection.has(modId))
        nextSelection.delete(modId);
    else
        nextSelection.add(modId);

    bulkDeleteModIds.value = nextSelection;
}

function getVerificationMessage(mod: InstalledMod): string {
    switch(mod.verification.status)
    {
        case "missing-directory":
            return `The mod directory "${mod.directoryName}" no longer exists. Restore it and refresh the mod list or delete it.`;
        case "missing-assets":
        {
            const missingAssets = mod.verification.missingAssets.join(", ");
            return `Required mod files are missing: ${missingAssets}. Restore them and refresh the mod list or delete it.`;
        }
        case "unreadable":
            return `The mod directory "${mod.directoryName}" could not be read. Check its permissions and refresh the mod list.`;
        case "valid":
            return "";
    }
}

function isModSelected(modId: string) {
    return selectedModIds.value.has(modId);
}

function clearFilters() {
    modNameFilter.value = "";
    characterFilter.value = "";
    modTypeFilter.value = "all";
    skinTypeFilter.value = "all";
    importedFrom.value = "";
    importedTo.value = "";
}

function cancelModDeletion() {
    if (isDeletingMod.value)
        return;

    deleteDialog.value?.close();
    modPendingDeletion.value = null;
}

function cancelModRename() {
    if (isRenamingMod.value)
        return;

    renameDialog.value?.close();
    modPendingRename.value = null;
    renameDirectoryName.value = "";
    renameErrorMessage.value = "";
}

function cancelBulkDeletion() {
    if (isBulkDeleting.value)
        return;

    isBulkDeleteMode.value = false;
    bulkDeleteModIds.value = new Set();
}

function closeBulkDeleteResult() {
    bulkDeleteResultDialog.value?.close();
    bulkDeleteSummary.value = null;
}

function retryLoading() {
    void Promise.all([
        catalogStore.load(true),
        modStore.load(true)
    ]);
}
</script>

<template>
    <section class="mods-view" aria-labelledby="mods-title">
        <header class="mods-header">
            <div>
                <p class="content-label">Library</p>
                <h1 id="mods-title">Mods</h1>
            </div>

            <div class="mods-header-actions">
                <button
                    v-if="modStore.mods.length > 0"
                    class="refresh-mods-button"
                    type="button"
                    :disabled="isRefreshing || isBulkDeleteMode"
                    @click="refreshMods"
                >
                    <RefreshIcon
                        :class="{ 'refresh-icon--spinning': isRefreshing }"
                    />
                    {{ isRefreshing ? "Refreshing..." : "Refresh mods" }}
                </button>

                <button
                    v-if="
                        modStore.mods.length > 1 &&
                        !isBulkDeleteMode
                    "
                    class="bulk-delete-button"
                    type="button"
                    @click="requestBulkDeletion"
                >
                    <TrashIcon />
                    Delete mods
                </button>

                <button
                    class="add-mod-button"
                    type="button"
                    aria-haspopup="dialog"
                    popovertarget="add-mod-popover"
                    :disabled="isBulkDeleteMode"
                >
                    <span aria-hidden="true">+</span>
                    Add mod
                </button>
            </div>
        </header>

        <form
            v-if="modStore.mods.length"
            class="mod-filters"
            @submit.prevent
        >
            <label class="text-filter">
                <span>Mod name</span>
                <span class="text-filter-control">
                    <SearchIcon aria-hidden="true" />
                    <input
                        v-model="modNameFilter"
                        type="search"
                        placeholder="Search mods"
                        autocomplete="off"
                    />
                </span>
            </label>

            <label class="text-filter">
                <span>Character</span>
                <span class="text-filter-control">
                    <SearchIcon aria-hidden="true" />
                    <input
                        v-model="characterFilter"
                        type="search"
                        placeholder="Character or skin"
                        autocomplete="off"
                    />
                </span>
            </label>

            <label class="select-filter">
                <span>Mod type</span>
                <select v-model="modTypeFilter">
                    <option value="all">All types</option>
                    <option value="normal">Normal</option>
                    <option value="damaged">Damaged</option>
                </select>
            </label>

            <label class="select-filter">
                <span>Skin type</span>
                <select v-model="skinTypeFilter">
                    <option value="all">All skin types</option>
                    <option value="spine">Spine</option>
                    <option value="animator">Animator</option>
                    <option value="static">Static</option>
                </select>
            </label>

            <fieldset class="date-filters">
                <legend>Import period</legend>

                <label>
                    <span class="visually-hidden">Imported from</span>
                    <input
                        v-model="importedFrom"
                        type="date"
                        title="Imported from"
                    />
                </label>

                <span aria-hidden="true">to</span>

                <label>
                    <span class="visually-hidden">Imported to</span>
                    <input
                        v-model="importedTo"
                        type="date"
                        title="Imported to"
                    />
                </label>
            </fieldset>
        </form>

        <div
            v-if="isLoading"
            class="view-message"
            aria-live="polite"
        >
            Loading mods...
        </div>

        <div
            v-else-if="loadErrorMessage"
            class="view-message view-message--error"
            role="alert"
        >
            <p>{{ loadErrorMessage }}</p>
            <button type="button" @click="retryLoading">
                Try again
            </button>
        </div>

        <div
            v-else-if="!modStore.mods.length"
            class="view-message"
        >
            <h2>No mods installed</h2>
            <p>Import a mod file to see it here.</p>
        </div>

        <template v-else>
            <div
                v-if="refreshErrorMessage"
                class="refresh-error"
                role="alert"
            >
                {{ refreshErrorMessage }}
            </div>

            <div class="table-summary">
                <p>
                    {{ filteredRows.length }}
                    {{ filteredRows.length === 1 ? "mod" : "mods" }}

                    <span v-if="invalidModCount > 0" class="invalid-mod-count">
                        · {{ invalidModCount }} need attention
                    </span>
                </p>

                <div
                    v-if="isBulkDeleteMode"
                    class="bulk-delete-instruction"
                    role="status"
                >
                    <TrashIcon aria-hidden="true" />
                    <span>
                        <strong>Select mods to delete</strong>
                        Use the checkboxes in the Mod name column.
                    </span>
                </div>

                <button
                    v-if="hasActiveFilters"
                    type="button"
                    @click="clearFilters"
                >
                    Clear filters
                </button>
            </div>

            <div
                v-if="actionErrorMessage"
                class="action-error"
                role="alert"
            >
                {{ actionErrorMessage }}
            </div>

            <div
                v-if="visibleRows.length"
                class="mods-table-wrapper"
                :class="{
                    'mods-table-wrapper--delete-mode': isBulkDeleteMode
                }"
            >
                <table class="mods-table">
                    <thead>
                        <tr>
                            <th :aria-sort="sortState('directoryName')">
                                <button
                                    type="button"
                                    @click="setSort('directoryName')"
                                >
                                    Mod name
                                    <span
                                        class="sort-indicator"
                                        :data-sort="sortState('directoryName')"
                                        aria-hidden="true"
                                    >
                                        <span class="sort-up"></span>
                                        <span class="sort-down"></span>
                                    </span>
                                </button>
                            </th>

                            <th :aria-sort="sortState('modType')">
                                <button
                                    type="button"
                                    @click="setSort('modType')"
                                >
                                    Mod type
                                    <span
                                        class="sort-indicator"
                                        :data-sort="sortState('modType')"
                                        aria-hidden="true"
                                    >
                                        <span class="sort-up"></span>
                                        <span class="sort-down"></span>
                                    </span>
                                </button>
                            </th>

                            <th :aria-sort="sortState('skinType')">
                                <button
                                    type="button"
                                    @click="setSort('skinType')"
                                >
                                    Skin type
                                    <span
                                        class="sort-indicator"
                                        :data-sort="sortState('skinType')"
                                        aria-hidden="true"
                                    >
                                        <span class="sort-up"></span>
                                        <span class="sort-down"></span>
                                    </span>
                                </button>
                            </th>

                            <th :aria-sort="sortState('character')">
                                <button
                                    type="button"
                                    @click="setSort('character')"
                                >
                                    Character
                                    <span
                                        class="sort-indicator"
                                        :data-sort="sortState('character')"
                                        aria-hidden="true"
                                    >
                                        <span class="sort-up"></span>
                                        <span class="sort-down"></span>
                                    </span>
                                </button>
                            </th>

                            <th :aria-sort="sortState('importedAt')">
                                <button
                                    type="button"
                                    @click="setSort('importedAt')"
                                >
                                    Import date
                                    <span
                                        class="sort-indicator"
                                        :data-sort="sortState('importedAt')"
                                        aria-hidden="true"
                                    >
                                        <span class="sort-up"></span>
                                        <span class="sort-down"></span>
                                    </span>
                                </button>
                            </th>

                            <th class="actions-heading">
                                <span>Actions</span>
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        <tr
                            v-for="row in visibleRows"
                            :key="row.mod.id"
                            :class="{
                                'mod-row--disabled': !isModSelected(row.mod.id),
                                'mod-row--invalid': row.mod.verification.status !== 'valid',
                                'mod-row--bulk-selected':
                                    isBulkDeleteMode &&
                                    bulkDeleteModIds.has(row.mod.id)
                            }"
                        >
                            <td>
                                <div class="mod-name-cell">
                                    <label
                                        class="enabled-toggle"
                                        :class="{
                                            'enabled-toggle--delete':
                                                isBulkDeleteMode
                                        }"
                                        :title="
                                            isBulkDeleteMode
                                                ? (
                                                    bulkDeleteModIds.has(row.mod.id)
                                                        ? 'Remove from deletion'
                                                        : 'Select for deletion'
                                                )
                                                : (
                                                    isModSelected(row.mod.id)
                                                        ? 'Remove from synchronization'
                                                        : 'Select for synchronization'
                                                )
                                        "
                                    >
                                        <input
                                            type="checkbox"
                                            :checked="
                                                isBulkDeleteMode
                                                    ? bulkDeleteModIds.has(row.mod.id)
                                                    : isModSelected(row.mod.id)
                                            "
                                            :disabled="
                                                !isBulkDeleteMode &&
                                                row.mod.verification.status !== 'valid'
                                            "
                                            @change="
                                                isBulkDeleteMode
                                                    ? toggleBulkDeleteMod(row.mod.id)
                                                    : toggleMod(row.mod.id, $event)
                                            "
                                        />
                                        <span aria-hidden="true">
                                            <CheckIcon
                                                v-if="
                                                    isBulkDeleteMode
                                                        ? bulkDeleteModIds.has(row.mod.id)
                                                        : isModSelected(row.mod.id)
                                                "
                                            />
                                        </span>
                                    </label>

                                    <strong :title="row.mod.directoryName">
                                        {{ row.mod.directoryName }}
                                    </strong>

                                    <ModWarning
                                        v-if="row.mod.verification.status !== 'valid'"
                                        heading="Mod files missing"
                                        tone="error"
                                        :message="getVerificationMessage(row.mod)"
                                    />

                                    <ModWarning
                                        v-if="conflictMessages.has(row.mod.id)"
                                        :message="conflictMessages.get(row.mod.id)!"
                                    />
                                </div>
                            </td>

                            <td>
                                <span
                                    class="type-badge"
                                    :class="
                                        `type-badge--${row.modType}`
                                    "
                                >
                                    {{ formatLabel(row.modType) }}
                                </span>
                            </td>

                            <td>
                                <span class="skin-type">
                                    {{ formatLabel(row.skinType) }}
                                </span>
                            </td>

                            <td>
                                <div class="character-cell">
                                    <span class="character-icon">
                                        <img
                                            v-if="row.iconUrl"
                                            :src="row.iconUrl"
                                            alt=""
                                            loading="lazy"
                                        />
                                        <span v-else aria-hidden="true">?</span>
                                    </span>

                                    <span :title="row.characterLabel">
                                        {{ row.characterLabel }}
                                    </span>
                                </div>
                            </td>

                            <td class="import-date">
                                <time :datetime="row.mod.importedAt">
                                    {{ formatImportDate(row) }}
                                </time>
                            </td>

                            <td>
                                <div class="mod-actions">
                                    <button
                                        type="button"
                                        aria-label="Open mod folder"
                                        title="Open folder"
                                        :disabled="
                                            isBulkDeleteMode ||
                                            row.mod.verification.status === 'missing-directory'
                                        "
                                        @click="openModFolder(row.mod)"
                                    >
                                        <FolderIcon />
                                    </button>

                                    <button
                                        type="button"
                                        aria-label="Rename mod"
                                        title="Rename mod"
                                        :disabled="
                                            isBulkDeleteMode ||
                                            row.mod.verification.status === 'missing-directory'
                                        "
                                        @click="requestModRename(row.mod)"
                                    >
                                        <RenameIcon />
                                    </button>

                                    <button
                                        class="delete-mod-button"
                                        type="button"
                                        aria-label="Delete mod"
                                        title="Delete mod"
                                        :disabled="isBulkDeleteMode"
                                        @click="requestModDeletion(row.mod)"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-else class="view-message">
                <p>No mods match these filters.</p>
                <button type="button" @click="clearFilters">
                    Clear filters
                </button>
            </div>

            <footer
                v-if="sortedRows.length || isBulkDeleteMode"
                class="table-pagination"
            >
                <p v-if="sortedRows.length">
                    Showing {{ firstVisibleResult }}–{{ lastVisibleResult }}
                    of {{ sortedRows.length }}
                </p>

                <div v-if="sortedRows.length">
                    <button
                        type="button"
                        :disabled="currentPage === 1"
                        @click="currentPage--"
                    >
                        Previous
                    </button>

                    <span>
                        Page {{ currentPage }} of {{ totalPages }}
                    </span>

                    <button
                        type="button"
                        :disabled="currentPage === totalPages"
                        @click="currentPage++"
                    >
                        Next
                    </button>
                </div>

                <div
                    v-if="isBulkDeleteMode"
                    class="bulk-delete-floating-actions"
                    aria-label="Bulk deletion controls"
                >
                    <p>
                        <strong>{{ bulkDeleteSelectionCount }}</strong>
                        {{
                            bulkDeleteSelectionCount === 1
                                ? "mod selected"
                                : "mods selected"
                        }}
                    </p>

                    <button
                        type="button"
                        :disabled="isBulkDeleting"
                        @click="cancelBulkDeletion"
                    >
                        Cancel
                    </button>

                    <button
                        class="bulk-delete-confirm-button"
                        type="button"
                        :disabled="
                            isBulkDeleting || bulkDeleteSelectionCount === 0
                        "
                        @click="confirmBulkDeletion"
                    >
                        <TrashIcon />
                        {{
                            isBulkDeleting
                                ? "Deleting..."
                                : "Delete selected"
                        }}
                    </button>
                </div>
            </footer>
        </template>
    </section>

    <dialog
        ref="deleteDialog"
        class="mod-action-dialog delete-mod-dialog"
        aria-labelledby="delete-mod-title"
        aria-describedby="delete-mod-description"
        @cancel.prevent="cancelModDeletion"
    >
        <div class="mod-dialog-content">
            <p class="mod-dialog-label mod-dialog-label--danger">
                Delete mod
            </p>

            <h2 id="delete-mod-title">
                Delete {{ modPendingDeletion?.directoryName }}?
            </h2>

            <p id="delete-mod-description">
                This removes the mod from the library and permanently deletes
                its files. This action cannot be undone.
            </p>

            <div class="mod-dialog-actions">
                <button
                    type="button"
                    :disabled="isDeletingMod"
                    @click="cancelModDeletion"
                >
                    Cancel
                </button>

                <button
                    class="confirm-delete-button"
                    type="button"
                    :disabled="isDeletingMod"
                    @click="confirmModDeletion"
                >
                    {{ isDeletingMod ? "Deleting..." : "Delete mod" }}
                </button>
            </div>
        </div>
    </dialog>

    <dialog
        ref="renameDialog"
        class="mod-action-dialog rename-mod-dialog"
        aria-labelledby="rename-mod-title"
        aria-describedby="rename-mod-description"
        @cancel.prevent="cancelModRename"
    >
        <form class="mod-dialog-content" @submit.prevent="confirmModRename">
            <p class="mod-dialog-label">Rename mod</p>

            <h2 id="rename-mod-title">
                Choose a new mod name
            </h2>

            <p id="rename-mod-description">
                This will also rename the mod's directory.
            </p>

            <label class="rename-mod-field" for="rename-mod-name">
                <span>Mod name</span>
                <input
                    id="rename-mod-name"
                    v-model="renameDirectoryName"
                    type="text"
                    maxlength="80"
                    autocomplete="off"
                    spellcheck="false"
                    autofocus
                    :disabled="isRenamingMod"
                    @input="renameErrorMessage = ''"
                />
            </label>

            <p
                v-if="renameErrorMessage"
                class="rename-mod-error"
                role="alert"
            >
                {{ renameErrorMessage }}
            </p>

            <div class="mod-dialog-actions">
                <button
                    type="button"
                    :disabled="isRenamingMod"
                    @click="cancelModRename"
                >
                    Cancel
                </button>

                <button
                    class="confirm-rename-button"
                    type="submit"
                    :disabled="
                        isRenamingMod || !renameDirectoryName.trim()
                    "
                >
                    {{ isRenamingMod ? "Renaming..." : "Rename mod" }}
                </button>
            </div>
        </form>
    </dialog>

    <dialog
        ref="bulkDeleteResultDialog"
        class="mod-action-dialog bulk-delete-result-dialog"
        aria-labelledby="bulk-delete-result-title"
        aria-describedby="bulk-delete-result-description"
        @cancel.prevent="closeBulkDeleteResult"
    >
        <div v-if="bulkDeleteSummary" class="mod-dialog-content">
            <p
                class="mod-dialog-label"
                :class="{
                    'mod-dialog-label--danger':
                        bulkDeleteSummary.requestError ||
                        bulkDeleteSummary.failures.length > 0
                }"
            >
                Deletion results
            </p>

            <h2 id="bulk-delete-result-title">
                <template v-if="bulkDeleteSummary.requestError">
                    Mods could not be deleted
                </template>
                <template v-else-if="bulkDeleteSummary.failures.length">
                    Deletion completed with issues
                </template>
                <template v-else>
                    {{ bulkDeleteSummary.deletedCount }}
                    {{
                        bulkDeleteSummary.deletedCount === 1
                            ? "mod deleted"
                            : "mods deleted"
                    }}
                </template>
            </h2>

            <p id="bulk-delete-result-description">
                <template v-if="bulkDeleteSummary.requestError">
                    {{ bulkDeleteSummary.requestError }}
                </template>
                <template v-else>
                    {{ bulkDeleteSummary.deletedCount }} of
                    {{ bulkDeleteSummary.requestedCount }}
                    selected mods were deleted.
                </template>
            </p>

            <div
                v-if="!bulkDeleteSummary.requestError"
                class="bulk-delete-result-counts"
            >
                <span>
                    <strong>{{ bulkDeleteSummary.deletedCount }}</strong>
                    Deleted
                </span>
                <span
                    :class="{
                        'bulk-delete-result-count--failed':
                            bulkDeleteSummary.failures.length > 0
                    }"
                >
                    <strong>{{ bulkDeleteSummary.failures.length }}</strong>
                    Failed
                </span>
            </div>

            <div
                v-if="bulkDeleteSummary.failures.length"
                class="bulk-delete-failures"
            >
                <p>Mods not deleted</p>

                <ul>
                    <li
                        v-for="failure in bulkDeleteSummary.failures"
                        :key="failure.directoryName"
                    >
                        <strong>{{ failure.directoryName }}</strong>
                        <span>{{ failure.message }}</span>
                    </li>
                </ul>
            </div>

            <div class="mod-dialog-actions">
                <button
                    type="button"
                    autofocus
                    @click="closeBulkDeleteResult"
                >
                    Done
                </button>
            </div>
        </div>
    </dialog>
</template>

<style scoped>
.mods-view {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
}

.mods-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 28px;
}

.content-label {
    margin: 0 0 6px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

h1 {
    margin: 0;
    color: #f2eee5;
    font-size: clamp(34px, 4vw, 44px);
    letter-spacing: -0.02em;
    line-height: 1.1;
}

.add-mod-button {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 0 19px;
    border: 0;
    border-radius: 8px;
    color: #172027;
    background: #86aec7;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
}

.add-mod-button:hover:not(:disabled) {
    background: #9bbfd5;
}

.add-mod-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.add-mod-button span {
    font-size: 21px;
    line-height: 1;
}

.mod-filters {
    display: grid;
    grid-template-columns:
        minmax(170px, 1fr)
        minmax(190px, 1fr)
        minmax(130px, 0.55fr)
        minmax(130px, 0.55fr)
        minmax(280px, 0.9fr);
    gap: 10px;
    padding: 18px 0;
    border-top: 1px solid #292e2b;
    border-bottom: 1px solid #292e2b;
}

.mod-filters label,
.date-filters {
    min-width: 0;
}

.mod-filters label > span:first-child,
.date-filters legend {
    display: block;
    margin-bottom: 7px;
    color: #858a84;
    font-size: 12px;
    font-weight: 600;
}

.text-filter-control {
    position: relative;
    display: block;
}

.text-filter-control svg {
    position: absolute;
    top: 50%;
    left: 13px;
    width: 17px;
    height: 17px;
    fill: none;
    stroke: #858a84;
    stroke-width: 1.8;
    pointer-events: none;
    transform: translateY(-50%);
}

.mod-filters input,
.mod-filters select {
    width: 100%;
    height: 42px;
    border: 1px solid #343936;
    border-radius: 7px;
    color: #dedad1;
    background: #0c0e0d;
    font: inherit;
    font-size: 13px;
}

.text-filter input {
    padding: 0 12px 0 40px;
}

.select-filter select {
    padding: 0 38px 0 12px;
    appearance: none;
    color-scheme: dark;
}

.mod-filters input:focus,
.mod-filters select:focus {
    border-color: #86aec7;
    outline: 0;
}

.date-filters {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) auto minmax(110px, 1fr);
    align-items: end;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
}

.date-filters legend {
    grid-column: 1 / -1;
    padding: 0;
}

.date-filters > span {
    padding-bottom: 12px;
    color: #777c76;
    font-size: 12px;
}

.date-filters input {
    padding: 0 9px;
    color-scheme: dark;
}

.table-summary {
    position: relative;
    display: flex;
    min-height: 50px;
    align-items: center;
    justify-content: space-between;
}

.table-summary p,
.table-pagination p {
    margin: 0;
    color: #8f948e;
    font-size: 13px;
}

.table-summary button,
.view-message button {
    padding: 0;
    border: 0;
    color: #9bc2d9;
    background: transparent;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}

.mods-table-wrapper {
    position: relative;
    min-width: 0;
    min-height: 0;
    flex: 1;
    overflow: auto;
    border: 1px solid #292e2b;
    border-radius: 9px;
}

.mods-table {
    width: 100%;
    min-width: 1040px;
    border-collapse: collapse;
    table-layout: fixed;
}

.mods-table th:nth-child(1) {
    width: 25%;
}

.mods-table th:nth-child(2),
.mods-table th:nth-child(3) {
    width: 10%;
}

.mods-table th:nth-child(4) {
    width: 33%;
}

.mods-table th:nth-child(5) {
    width: 10%;
}

.mods-table th:nth-child(6) {
    width: 12%;
}

.mods-table th {
    height: 46px;
    padding: 0 15px;
    border-bottom: 1px solid #303532;
    background: #101311;
    text-align: left;
}

.mods-table thead {
    position: sticky;
    z-index: 1;
    top: 0;
}

.mods-table th button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    color: #9da19b;
    background: transparent;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
}

.mods-table th button:hover {
    color: #e4e0d7;
}

.sort-indicator {
    display: inline-flex;
    width: 10px;
    height: 14px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
}

.sort-up,
.sort-down {
    width: 0;
    height: 0;
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
    opacity: 0.3;
}

.sort-up {
    border-bottom: 4px solid currentColor;
}

.sort-down {
    border-top: 4px solid currentColor;
}

.sort-indicator[data-sort="ascending"] .sort-up,
.sort-indicator[data-sort="descending"] .sort-down {
    color: #9bc2d9;
    opacity: 1;
}

.mods-table td {
    height: 66px;
    padding: 10px 15px;
    overflow: hidden;
    border-bottom: 1px solid #202421;
    color: #b4b7b1;
    font-size: 13px;
}

.mods-table tbody tr {
    background: #0d100e;
    transition: background-color 120ms ease;
}

.mods-table tbody tr:hover {
    background: #131714;
}

.mods-table tbody tr:last-child td {
    border-bottom: 0;
}

.mod-row--disabled {
    background: #0b0d0c;
}

.mod-row--disabled:hover {
    background: #111411;
}

.mod-row--disabled .mod-name-cell strong,
.mod-row--disabled .character-cell > span:last-child {
    color: #b9bcb6;
}

.mod-row--disabled .character-icon {
    opacity: 0.85;
    filter: saturate(0.72);
}

.mod-name-cell,
.character-cell {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 11px;
}

.mod-name-cell strong,
.character-cell > span:last-child {
    min-width: 0;
    overflow: hidden;
    color: #e4e0d7;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.enabled-toggle {
    position: relative;
    flex: 0 0 auto;
    cursor: pointer;
}

.enabled-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.enabled-toggle > span {
    display: inline-flex;
    width: 18px;
    height: 18px;
    align-items: center;
    justify-content: center;
    border: 1px solid #4a504c;
    border-radius: 4px;
    color: #172027;
}

.enabled-toggle input:checked + span {
    border-color: #86aec7;
    background: #86aec7;
}

.enabled-toggle input:focus-visible + span {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.enabled-toggle input:disabled + span {
    border-color: #633936;
    cursor: not-allowed;
    opacity: 0.65;
}

.enabled-toggle svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
}

.type-badge {
    display: inline-flex;
    width: 72px;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    padding: 0 9px;
    box-sizing: border-box;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 650;
}

.type-badge--normal {
    color: #c6e0ee;
    background: #18252b;
}

.type-badge--damaged {
    color: #e5b7b7;
    background: #2a1d1d;
}

.skin-type {
    color: #b4b7b1;
    font-weight: 600;
}

.character-icon {
    display: inline-flex;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 6px;
    color: #777c76;
    background: #1a1e1b;
}

.character-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.import-date {
    color: #969b95;
    white-space: nowrap;
}

.table-pagination {
    position: relative;
    display: flex;
    min-height: 64px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
}

.table-pagination > div {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #969b95;
    font-size: 13px;
}

.table-pagination button {
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    color: #dcd8cf;
    background: #171b18;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
}

.table-pagination button:hover:not(:disabled) {
    background: #202622;
}

.table-pagination button:disabled {
    cursor: default;
    opacity: 0.4;
}

.refresh-error,
.action-error {
    margin-top: 14px;
    padding: 11px 13px;
    border-radius: 6px;
    color: #efa3a3;
    background: #241717;
    font-size: 13px;
}

.view-message {
    display: flex;
    min-height: 320px;
    flex: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 12px;
    color: #969b95;
    text-align: center;
}

.view-message h2,
.view-message p {
    margin: 0;
}

.view-message--error {
    color: #efa3a3;
}

.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
}

.mods-header-actions {
    display: flex;
    align-items: center;
    gap: 9px;
}

.refresh-mods-button {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    color: #d8d4cb;
    background: #171b18;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.bulk-delete-button {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    color: #d9b0ac;
    background: #1e1716;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.bulk-delete-button:hover {
    color: #f0c2bd;
    background: #2b1c1a;
}

.bulk-delete-button svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.refresh-mods-button:hover:not(:disabled) {
    background: #202622;
}

.refresh-mods-button:disabled {
    cursor: wait;
    opacity: 0.65;
}

.refresh-mods-button svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.refresh-icon--spinning {
    animation: refresh-icon-spin 700ms linear infinite;
}

.invalid-mod-count {
    color: #e69b93;
    font-weight: 600;
}

.mod-row--invalid {
    background: #110d0c;
}

.mod-row--invalid:hover {
    background: #18100f;
}

.mod-row--invalid .enabled-toggle {
    cursor: not-allowed;
}

.mods-table th.actions-heading {
    color: #9da19b;
    font-size: 12px;
    font-weight: 650;
    text-align: left;
}

.mod-actions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
}

.mod-actions button {
    display: inline-flex;
    width: 30px;
    height: 30px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: #9da19b;
    background: transparent;
    cursor: pointer;
}

.mod-actions button:hover:not(:disabled) {
    color: #dcecf5;
    background: #192126;
}

.mod-actions .delete-mod-button:hover:not(:disabled) {
    color: #f0a29a;
    background: #2d1b1a;
}

.mod-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
}

.mod-actions svg {
    display: block;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.mod-actions button:focus-visible,
.mod-dialog-actions button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.mod-action-dialog {
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    margin: auto;
    padding: 0;
    overflow: auto;
    border: 1px solid #383d39;
    border-radius: 12px;
    color: #e4e0d7;
    background: #0e110f;
    box-shadow: 0 22px 60px rgb(0 0 0 / 50%);
}

.mod-action-dialog::backdrop {
    background: rgb(0 0 0 / 72%);
}

.mod-dialog-content {
    padding: 26px;
}

.mod-dialog-label {
    margin: 0 0 5px;
    color: #91b8cf;
    font-size: 12px;
    font-weight: 700;
}

.mod-dialog-label--danger {
    color: #e69b93;
}

.mod-dialog-content h2 {
    margin: 0;
    color: #f2eee5;
    font-size: 22px;
}

.mod-dialog-content > p:not(
    .mod-dialog-label,
    .rename-mod-error
) {
    margin: 14px 0 0;
    color: #a9ada7;
    font-size: 14px;
    line-height: 1.55;
}

.mod-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 24px;
}

.mod-dialog-actions button {
    min-height: 40px;
    padding: 0 15px;
    border: 0;
    border-radius: 7px;
    color: #d8d4cb;
    background: #1a1e1b;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.mod-dialog-actions .confirm-delete-button {
    color: #fff0ed;
    background: #713d38;
}

.mod-dialog-actions .confirm-delete-button:hover:not(:disabled) {
    background: #854a44;
}

.mod-dialog-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.rename-mod-field {
    display: grid;
    gap: 7px;
    margin-top: 20px;
    color: #b9bcb6;
    font-size: 12px;
    font-weight: 650;
}

.rename-mod-field input {
    width: 100%;
    height: 42px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 1px solid #343936;
    border-radius: 7px;
    color: #e4e0d7;
    background: #0a0d0b;
    font: inherit;
    font-size: 14px;
}

.rename-mod-field input:focus {
    border-color: #86aec7;
    outline: 0;
}

.rename-mod-field input:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.rename-mod-error {
    margin: 9px 0 0;
    color: #efa3a3;
    font-size: 13px;
    line-height: 1.45;
}

.mod-dialog-actions .confirm-rename-button {
    color: #10202a;
    background: #91b8cf;
}

.mod-dialog-actions .confirm-rename-button:hover:not(:disabled) {
    background: #a3c7dc;
}

.mods-table-wrapper--delete-mode {
    border-color: #5b3834;
}

.bulk-delete-instruction {
    position: absolute;
    z-index: 3;
    top: 50%;
    left: 50%;
    display: flex;
    width: fit-content;
    max-width: 100%;
    align-items: center;
    gap: 10px;
    padding: 8px 13px;
    border: 1px solid #603c38;
    border-radius: 8px;
    color: #d9b0ac;
    background: #211716;
    box-shadow: 0 8px 24px rgb(0 0 0 / 38%);
    transform: translate(-50%, -50%);
}

.bulk-delete-instruction svg {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
}

.bulk-delete-instruction span {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 0 6px;
    font-size: 12px;
    line-height: 1.4;
}

.bulk-delete-instruction strong {
    color: #f0c2bd;
}

.enabled-toggle--delete > span {
    border-color: #6b4642;
}

.enabled-toggle--delete input:checked + span {
    border-color: #c8746b;
    color: #211413;
    background: #c8746b;
}

.mod-row--bulk-selected,
.mod-row--bulk-selected:hover {
    background: #211413;
}

.mod-row--bulk-selected .mod-name-cell strong,
.mod-row--bulk-selected .character-cell > span:last-child {
    color: #f1d5d2;
}

.bulk-delete-floating-actions {
    position: absolute;
    z-index: 5;
    right: auto;
    top: 50%;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px;
    border: 1px solid #4e312e;
    border-radius: 10px;
    background: #111412;
    box-shadow: 0 8px 24px rgb(0 0 0 / 42%);
    transform: translate(-50%, -50%);
}

.bulk-delete-floating-actions p {
    margin: 0 9px 0 4px;
    color: #aaafa9;
    font-size: 12px;
    white-space: nowrap;
}

.bulk-delete-floating-actions p strong {
    color: #f2eee5;
    font-size: 14px;
}

.bulk-delete-floating-actions button {
    display: inline-flex;
    min-height: 38px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 13px;
    border: 0;
    border-radius: 7px;
    color: #d8d4cb;
    background: #1b1f1c;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
}

.bulk-delete-floating-actions button:hover:not(:disabled) {
    background: #252a26;
}

.bulk-delete-floating-actions .bulk-delete-confirm-button {
    color: #fff0ed;
    background: #713d38;
}

.bulk-delete-floating-actions .bulk-delete-confirm-button:hover:not(:disabled) {
    background: #854a44;
}

.bulk-delete-floating-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.bulk-delete-floating-actions button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.bulk-delete-floating-actions svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
}

.bulk-delete-result-dialog {
    width: min(520px, calc(100vw - 32px));
}

.bulk-delete-result-counts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 20px;
}

.bulk-delete-result-counts > span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 7px;
    color: #a7aca6;
    background: #151916;
    font-size: 12px;
}

.bulk-delete-result-counts strong {
    color: #f2eee5;
    font-size: 22px;
    line-height: 1.1;
}

.bulk-delete-result-counts .bulk-delete-result-count--failed {
    color: #d9a29d;
    background: #1d1413;
}

.bulk-delete-result-count--failed strong {
    color: #efa39b;
}

.bulk-delete-failures {
    margin-top: 18px;
}

.bulk-delete-failures > p {
    margin: 0 0 8px;
    color: #e69b93;
    font-size: 12px;
    font-weight: 700;
}

.bulk-delete-failures ul {
    display: grid;
    max-height: 220px;
    gap: 6px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}

.bulk-delete-failures li {
    display: grid;
    min-width: 0;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 6px;
    background: #1b1312;
}

.bulk-delete-failures li strong,
.bulk-delete-failures li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bulk-delete-failures li strong {
    color: #edc3bf;
    font-size: 13px;
}

.bulk-delete-failures li span {
    color: #b4938f;
    font-size: 12px;
}

@media (max-width: 1280px) {
    .mod-filters {
        grid-template-columns: repeat(2, minmax(180px, 1fr));
    }

    .date-filters {
        grid-column: span 2;
    }
}

@media (max-width: 720px) {
    .mods-header,
    .table-pagination {
        align-items: stretch;
        flex-direction: column;
    }

    .mod-filters {
        grid-template-columns: minmax(0, 1fr);
    }

    .date-filters {
        grid-column: auto;
    }

    .mods-header-actions {
        width: 100%;
        flex-direction: column-reverse;
    }

    .refresh-mods-button,
    .bulk-delete-button,
    .add-mod-button {
        width: 100%;
    }

    .bulk-delete-instruction {
        width: calc(100% - 20px);
        max-width: none;
        box-sizing: border-box;
    }

    .bulk-delete-floating-actions {
        position: static;
        right: 0;
        top: auto;
        left: 0;
        flex-wrap: wrap;
        transform: none;
    }

    .bulk-delete-floating-actions p {
        flex: 1 1 100%;
        margin: 0;
        text-align: center;
    }

    .bulk-delete-floating-actions button {
        flex: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .mods-table tbody tr {
        transition: none;
    }

    .refresh-icon--spinning {
        animation: none;
    }
}
</style>
