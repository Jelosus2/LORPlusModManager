<script setup lang="ts">
import type { CharacterSkin } from "../../shared/characters";

import SearchIcon from "./icons/SearchIcon.vue";
import CheckIcon from "./icons/CheckIcon.vue";
import MinusIcon from "./icons/MinusIcon.vue";

import { useCharacterCatalogStore } from "@/stores/characterCatalogStore";
import { getCharacterIconUrl } from "@/data/characterIcons";
import { useModStore } from "@/stores/modStore.ts";
import { computed, ref } from "vue";

type SkinTypeFilter = "all" | "spine" | "animator" | "static";

type CharacterRow = {
    key: string;
    normal: CharacterSkin;
    damaged: CharacterSkin | null;
    iconUrl: string | null;
    normalModCount: number;
    damagedModCount: number;
    totalModCount: number;
};

const catalogStore = useCharacterCatalogStore();
const modStore = useModStore();

const nameFilter = ref("");
const skinTypeFilter = ref<SkinTypeFilter>("all");
const onlyWithNormalMods = ref(false);
const onlyWithDamagedMods = ref(false);

const characterRows = computed<CharacterRow[]>(() => {
    const damagedSkins = new Map<string, CharacterSkin>();

    for (const skin of catalogStore.skins)
    {
        if (!skin.skin2dId.endsWith("_Dam"))
            continue;

        damagedSkins.set(skin.skin2dId.slice(0, -4), skin);
    }

    return catalogStore.skins
        .filter((skin) => !skin.skin2dId.endsWith("_Dam"))
        .map((normal) => {
            const damaged = damagedSkins.get(normal.skin2dId) ?? null;
            const normalModCount = modStore.getModsForSkin(normal.skin2dId, normal.variantId).length;
            const damagedModCount = damaged
                ? modStore.getModsForSkin(damaged.skin2dId, damaged.variantId).length
                : 0;

            return {
                key: `${normal.skin2dId}::${normal.variantId ?? ""}`,
                normal,
                damaged,
                iconUrl: getCharacterIconUrl(normal.iconFile) ?? null,
                normalModCount,
                damagedModCount,
                totalModCount: normalModCount + damagedModCount
            };
        });
});

const filteredRows = computed(() => {
    const normalizedName = nameFilter.value.trim().toLowerCase();

    return characterRows.value.filter((row) => {
        if (normalizedName)
        {
            const searchableName = `${row.normal.characterName} ${row.normal.skinName}`.toLowerCase();
            if (!searchableName.includes(normalizedName))
                return false;
        }

        if (skinTypeFilter.value !== "all" && !matchesSkinType(row, skinTypeFilter.value))
            return false;
        if (onlyWithNormalMods.value && row.normalModCount === 0)
            return false;
        if (onlyWithDamagedMods.value && row.damagedModCount === 0)
            return false;

        return true;
    });
});

const hasActiveFilters = computed(() =>
    Boolean(
        nameFilter.value ||
        skinTypeFilter.value !== "all" ||
        onlyWithNormalMods.value ||
        onlyWithDamagedMods.value
    )
);

const isLoading = computed(() => catalogStore.isLoading || modStore.isLoading);
const loadErrorMessage = computed(() => catalogStore.errorMessage || modStore.errorMessage);

function matchesSkinType(row: CharacterRow, type: Exclude<SkinTypeFilter, "all">): boolean {
    const skins = row.damaged
        ? [row.normal, row.damaged]
        : [row.normal];

    return skins.some((skin) => {
        switch (type)
        {
            case "spine":
                return skin.isSpineSkin;
            case "animator":
                return skin.isAnimatorSkin;
            case "static":
                return skin.isStaticSkin;
        }
    });
}

function formatModCount(count: number): string {
    return `${count} ${count === 1 ? "mod" : "mods"}`;
}

function clearFilters() {
    nameFilter.value = "";
    skinTypeFilter.value = "all";
    onlyWithNormalMods.value = false;
    onlyWithDamagedMods.value = false;
}

function retryLoading() {
    void Promise.all([
        catalogStore.load(true),
        modStore.load(true)
    ]);
}
</script>

<template>
    <section class="characters-view" aria-labelledby="characters-title">
        <header class="characters-header">
            <div>
                <p class="content-label">Library</p>
                <h1 id="characters-title">Characters</h1>
            </div>

            <p v-if="catalogStore.catalog" class="catalog-version">
                Catalog {{ catalogStore.catalog.version }}
            </p>
        </header>

        <form class="character-filters" @submit.prevent>
            <label class="search-filter">
                <span class="visually-hidden">
                    Search characters and skins
                </span>
                <SearchIcon class="search-icon" />
                <input
                    v-model="nameFilter"
                    type="search"
                    placeholder="Search characters or skins"
                    autocomplete="off"
                />
            </label>

            <label class="type-filter">
                <span class="visually-hidden">Skin type</span>
                <select v-model="skinTypeFilter">
                    <option value="all">All skin types</option>
                    <option value="spine">Spine</option>
                    <option value="animator">Animator</option>
                    <option value="static">Static</option>
                </select>
            </label>

            <label
                class="filter-toggle"
                :class="{
                    'filter-toggle--active': onlyWithNormalMods
                }"
            >
                <input
                    v-model="onlyWithNormalMods"
                    type="checkbox"
                />
                <span class="filter-checkbox" aria-hidden="true">
                    <CheckIcon v-if="onlyWithNormalMods" />
                </span>
                Normal mods
            </label>

            <label
                class="filter-toggle"
                :class="{
                    'filter-toggle--active': onlyWithDamagedMods
                }"
            >
                <input
                    v-model="onlyWithDamagedMods"
                    type="checkbox"
                />
                <span class="filter-checkbox" aria-hidden="true">
                    <CheckIcon v-if="onlyWithDamagedMods" />
                </span>
                Damaged mods
            </label>
        </form>

        <div
            v-if="!isLoading && !loadErrorMessage"
            class="results-header"
        >
            <p>
                {{ filteredRows.length }}
                of
                {{ characterRows.length }}
                skins
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
            v-if="isLoading"
            class="view-message"
            aria-live="polite"
        >
            Loading characters and mods...
        </div>

        <div
            v-else-if="loadErrorMessage"
            class="view-message view-message--error"
            role="alert"
        >
            <p>{{ loadErrorMessage }}</p>
            <button
                type="button"
                @click="retryLoading"
            >
                Try again
            </button>
        </div>

        <div v-else-if="filteredRows.length" class="character-grid">
            <article
                v-for="entry in filteredRows"
                :key="entry.key"
                class="character-entry"
            >
                <div class="character-icon">
                    <img
                        v-if="entry.iconUrl"
                        :src="entry.iconUrl"
                        :alt="entry.normal.characterName"
                        loading="lazy"
                    />
                    <span v-else aria-hidden="true">?</span>
                </div>

                <div class="character-details">
                    <h2 :title="`${entry.normal.characterName}: ${entry.normal.skinName}`">
                        {{ entry.normal.characterName }}:
                        {{ entry.normal.skinName }}
                    </h2>
                    <p>{{ formatModCount(entry.totalModCount) }}</p>
                </div>

                <div class="mod-states">
                    <div
                        class="mod-state"
                        :class="{
                            'mod-state--installed':
                                entry.normalModCount > 0
                        }"
                        :aria-label="
                            entry.normalModCount > 0
                                ? `Normal has ${formatModCount(entry.normalModCount)}`
                                : 'Normal has no mods'
                        "
                    >
                        <span class="mod-state-icon" aria-hidden="true">
                            <CheckIcon
                                v-if="entry.normalModCount > 0"
                            />
                            <MinusIcon v-else />
                        </span>
                        <span>Normal</span>
                    </div>

                    <div
                        v-if="entry.damaged"
                        class="mod-state"
                        :class="{
                            'mod-state--installed':
                                entry.damagedModCount > 0
                        }"
                        :aria-label="
                            entry.damagedModCount > 0
                                ? `Damaged has ${formatModCount(entry.damagedModCount)}`
                                : 'Damaged has no mods'
                        "
                    >
                        <span class="mod-state-icon" aria-hidden="true">
                            <CheckIcon
                                v-if="entry.damagedModCount > 0"
                            />
                            <MinusIcon v-else />
                        </span>
                        <span>Damaged</span>
                    </div>
                </div>
            </article>
        </div>

        <div v-else class="view-message">
            <p>No characters match these filters.</p>
            <button
                v-if="hasActiveFilters"
                type="button"
                @click="clearFilters"
            >
                Clear filters
            </button>
        </div>
    </section>
</template>

<style scoped>
.characters-view {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
}

.characters-header {
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
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(34px, 4vw, 44px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
}

.catalog-version {
    margin: 0 0 4px;
    color: #858a84;
    font-size: 13px;
}

.character-filters {
    display: grid;
    grid-template-columns: minmax(220px, 2fr) minmax(150px, 0.8fr) auto auto;
    gap: 10px;
    padding: 18px 4px 18px 0;
    border-top: 1px solid #292e2b;
    border-bottom: 1px solid #292e2b;
}

.search-filter {
    position: relative;
}

.type-filter {
    position: relative;
}

.type-filter::after {
    position: absolute;
    top: 50%;
    right: 16px;
    width: 7px;
    height: 7px;
    border-right: 2px solid #a9ada7;
    border-bottom: 2px solid #a9ada7;
    content: "";
    pointer-events: none;
    transform: translateY(-70%) rotate(45deg);
}

.search-icon {
    position: absolute;
    top: 50%;
    left: 14px;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: #8f948e;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
    transform: translateY(-50%);
}

.search-filter input,
.type-filter select {
    width: 100%;
    height: 44px;
    border: 1px solid #343936;
    border-radius: 7px;
    color: #dedad1;
    background: #0c0e0d;
    font: inherit;
    font-size: 14px;
}

.search-filter input {
    padding: 0 14px 0 43px;
}

.search-filter input::placeholder {
    color: #757a74;
}

.type-filter select {
    padding: 0 42px 0 13px;
    appearance: none;
    color-scheme: dark;
    cursor: pointer;
}

.search-filter input:focus,
.type-filter select:focus {
    border-color: #86aec7;
    outline: 0;
}

.filter-toggle {
    position: relative;
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 9px;
    padding: 0 13px;
    border-radius: 7px;
    color: #a9ada7;
    background: #121513;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
}

.filter-toggle:hover {
    color: #e4e0d7;
    background: #171b18;
}

.filter-toggle--active {
    color: #dcecf5;
    background: #182329;
}

.filter-toggle input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}

.filter-toggle:focus-within {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.filter-checkbox {
    display: inline-flex;
    width: 17px;
    height: 17px;
    align-items: center;
    justify-content: center;
    border: 1px solid #4a504c;
    border-radius: 4px;
    color: #172027;
}

.filter-toggle--active .filter-checkbox {
    border-color: #86aec7;
    background: #86aec7;
}

.filter-checkbox svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.results-header {
    display: flex;
    min-height: 50px;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
}

.results-header p {
    margin: 0;
    color: #8f948e;
    font-size: 13px;
}

.results-header button,
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

.results-header button:hover,
.view-message button:hover {
    color: #c0dbea;
}

.character-grid {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 430px), 1fr));
    align-content: start;
    gap: 10px;
    padding-bottom: 36px;
    overflow: auto;
}

.character-entry {
    display: grid;
    min-height: 116px;
    grid-template-areas:
        "icon details"
        "icon states";
    grid-template-columns: 66px minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-content: start;
    column-gap: 15px;
    row-gap: 10px;
    padding: 14px;
    border-radius: 9px;
    background: #101311;
    content-visibility: auto;
    contain-intrinsic-size: auto 116px;
    transition: background-color 150ms ease;
}

.character-entry:hover {
    background: #151916;
}

.character-icon {
    grid-area: icon;
    display: flex;
    width: 66px;
    height: 66px;
    align-self: start;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 7px;
    color: #777c76;
    background: #1a1e1b;
    font-size: 20px;
    font-weight: 600;
}

.character-icon img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.character-details {
    grid-area: details;
    min-width: 0;
}

.character-details h2 {
    margin: 0;
    overflow: hidden;
    color: #e4e0d7;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.character-details p {
    margin: 6px 0 0;
    color: #858a84;
    font-size: 13px;
}

.mod-states {
    grid-area: states;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
}

.mod-state {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    gap: 7px;
    padding: 0 10px;
    border-radius: 6px;
    color: #888d87;
    background: #191c1a;
    font-size: 12px;
    font-weight: 600;
}

.mod-state--installed {
    color: #c6e0ee;
    background: #18252b;
}

.mod-state-icon {
    display: inline-flex;
    width: 17px;
    height: 17px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #8b908a;
    background: #292d2a;
}

.mod-state--installed .mod-state-icon {
    color: #172027;
    background: #86aec7;
}

.mod-state-icon svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.view-message {
    display: flex;
    min-height: 320px;
    flex: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 14px;
    color: #969b95;
    text-align: center;
}

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

@media (max-width: 1120px) {
    .character-filters {
        grid-template-columns: minmax(220px, 1fr) minmax(150px, 0.7fr);
    }

    .filter-toggle {
        justify-content: center;
    }
}

@media (max-width: 720px) {
    .characters-header {
        align-items: flex-start;
        flex-direction: column;
        gap: 12px;
    }

    .character-filters {
        grid-template-columns: minmax(0, 1fr);
    }

    .character-entry {
        grid-template-areas:
            "icon details"
            "icon states";
        grid-template-columns: 58px minmax(0, 1fr);
    }

    .character-icon {
        width: 58px;
        height: 58px;
    }

    .mod-states {
        justify-content: flex-start;
    }
}

@media (max-width: 440px) {
    .character-entry {
        align-items: start;
    }
}

@media (prefers-reduced-motion: reduce) {
    .character-entry {
        transition: none;
    }
}
</style>
