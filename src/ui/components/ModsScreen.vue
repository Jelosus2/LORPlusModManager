<script setup lang="ts">
import type { CharacterSkin } from "../../shared/characters";
import type { InstalledMod } from "../../shared/mod";

import ConflictWarning from "./ConflictWarning.vue";
import SearchIcon from "./icons/SearchIcon.vue";
import CheckIcon from "./icons/CheckIcon.vue";

import { useCharacterCatalogStore } from "@/stores/characterCatalogStore";
import { useModStore, createCatalogIdentity } from "@/stores/modStore";
import { getCharacterIconUrl } from "@/data/characterIcons";
import { StringUtils } from "@/utils/StringUtils";
import { computed, ref, watch } from "vue";

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
const sortKey = ref<SortKey>("importedAt");
const sortDirection = ref<SortDirection>("descending");
const currentPage = ref(1);
const selectedModIds = ref(new Set<string>());

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
        if (!selectedModIds.value.has(row.mod.id))
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

const isLoading = computed(() => modStore.isLoading || catalogStore.isLoading);
const loadErrorMessage = computed(() => modStore.errorMessage || catalogStore.errorMessage);

watch([modNameFilter, characterFilter, modTypeFilter, skinTypeFilter, importedFrom, importedTo], () => {
    currentPage.value = 1;
});

watch(() => modStore.mods, (mods) => {
    const currentModIds = new Set(mods.map((mod) => mod.id));
    const nextSelection = new Set([...selectedModIds.value].filter((id) => currentModIds.has(id)));

    for (const mod of mods)
    {
        if (!knownModIds.has(mod.id) && mod.enabled)
            nextSelection.add(mod.id);
    }

    selectedModIds.value = nextSelection;
    knownModIds = currentModIds;
}, { immediate: true });

watch(totalPages, (pageCount) => {
    if (currentPage.value > pageCount)
        currentPage.value = pageCount;
});

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

            <button
                class="add-mod-button"
                type="button"
                aria-haspopup="dialog"
                popovertarget="add-mod-popover"
            >
                <span aria-hidden="true">+</span>
                Add mod
            </button>
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
            <div class="table-summary">
                <p>
                    {{ filteredRows.length }}
                    {{ filteredRows.length === 1 ? "mod" : "mods" }}
                </p>

                <button
                    v-if="hasActiveFilters"
                    type="button"
                    @click="clearFilters"
                >
                    Clear filters
                </button>
            </div>

            <div
                v-if="visibleRows.length"
                class="mods-table-wrapper"
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
                        </tr>
                    </thead>

                    <tbody>
                        <tr
                            v-for="row in visibleRows"
                            :key="row.mod.id"
                            :class="{
                                'mod-row--disabled':
                                    !isModSelected(row.mod.id)
                            }"
                        >
                            <td>
                                <div class="mod-name-cell">
                                    <label
                                        class="enabled-toggle"
                                        :title="
                                            isModSelected(row.mod.id)
                                                ? 'Remove from synchronization'
                                                : 'Select for synchronization'
                                        "
                                    >
                                        <input
                                            type="checkbox"
                                            :checked="
                                                isModSelected(row.mod.id)
                                            "
                                            @change="
                                                toggleMod(row.mod.id, $event)
                                            "
                                        />
                                        <span aria-hidden="true">
                                            <CheckIcon
                                                v-if="
                                                    isModSelected(row.mod.id)
                                                "
                                            />
                                        </span>
                                    </label>

                                    <strong :title="row.mod.directoryName">
                                        {{ row.mod.directoryName }}
                                    </strong>

                                    <ConflictWarning
                                        v-if="
                                            conflictMessages.has(row.mod.id)
                                        "
                                        :message="
                                            conflictMessages.get(row.mod.id)!
                                        "
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
                v-if="sortedRows.length"
                class="table-pagination"
            >
                <p>
                    Showing {{ firstVisibleResult }}–{{ lastVisibleResult }}
                    of {{ sortedRows.length }}
                </p>

                <div>
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
            </footer>
        </template>
    </section>
</template>

<style scoped>
.mods-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
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

.add-mod-button:hover {
    background: #9bbfd5;
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
    min-width: 0;
    overflow: auto;
    border: 1px solid #292e2b;
    border-radius: 9px;
}

.mods-table {
    width: 100%;
    min-width: 960px;
    border-collapse: collapse;
    table-layout: fixed;
}

.mods-table th:nth-child(1) {
    width: 28%;
}

.mods-table th:nth-child(2),
.mods-table th:nth-child(3) {
    width: 12%;
}

.mods-table th:nth-child(4) {
    width: 32%;
}

.mods-table th:nth-child(5) {
    width: 16%;
}

.mods-table th {
    height: 46px;
    padding: 0 15px;
    border-bottom: 1px solid #303532;
    background: #101311;
    text-align: left;
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
    cursor: wait;
    opacity: 0.5;
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
    min-height: 28px;
    align-items: center;
    padding: 0 9px;
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

.update-error {
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

    .add-mod-button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .mods-table tbody tr {
        transition: none;
    }
}
</style>
