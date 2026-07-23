<script setup lang="ts">
import type { ModImportMode } from "../../shared/mod.ts";

import CharactersScreen from "./CharactersScreen.vue";
import ImportFileIcon from "./icons/ImportFileIcon.vue";
import ImportFilesIcon from "./icons/ImportFilesIcon.vue";

import { useCharacterCatalogStore } from "@/stores/characterCatalogStore";
import { ref, onMounted } from "vue";

type MainSection = "mods" | "characters";

const characterCatalog = useCharacterCatalogStore();

const activeSection = ref<MainSection>("mods");
const isSelectingMods = ref(false);
const importMessage = ref("");
const importFailed = ref(false);

async function selectModSources(mode: ModImportMode) {
    if (isSelectingMods.value)
        return;

    isSelectingMods.value = true;
    importMessage.value = "";
    importFailed.value = false;

    try
    {
        const result = await window.app.selectModSources(mode);
        if (result.canceled)
            return;

        importMessage.value = result.message;
        importFailed.value = !result.success;

        if (result.success)
        {
            // These are validated sources. The installation/registration step will be added next.
            console.log(result.sources);
        }
    }
    catch (error)
    {
        console.error("Couldn't process the mod sources:", error);

        importFailed.value = true;
        importMessage.value = "The selected mods could not be read.";
    } finally {
        isSelectingMods.value = false;
    }
}

onMounted(() => {
    void characterCatalog.load();
});
</script>

<template>
    <div class="app-shell">
        <aside class="sidebar">
            <nav class="main-navigation" aria-label="Main navigation">
                <button
                    class="navigation-item"
                    :class="{
                        'navigation-item--active': activeSection === 'mods'
                    }"
                    type="button"
                    :aria-current="activeSection === 'mods' ? 'page' : undefined"
                    @click="activeSection = 'mods'"
                >
                    Mods
                </button>

                <button
                    class="navigation-item"
                    :class="{
                        'navigation-item--active': activeSection === 'characters'
                    }"
                    type="button"
                    :aria-current="activeSection === 'characters' ? 'page' : undefined"
                    @click="activeSection = 'characters'"
                >
                    Characters
                </button>

                <button class="navigation-item" type="button">
                    Settings
                </button>
            </nav>
        </aside>

        <main class="main-content">
            <CharactersScreen v-if="activeSection === 'characters'" />

            <template v-else>
                <header class="content-header">
                    <div>
                        <p class="content-label">Library</p>
                        <h1>Mods</h1>
                    </div>

                    <button
                        class="add-mod-button"
                        type="button"
                        aria-haspopup="dialog"
                        popovertarget="add-mod-popover"
                    >
                        <span class="add-mod-symbol" aria-hidden="true">+</span>
                        Add mod
                    </button>
                </header>

                <section class="mods-content" aria-label="Installed mods">
                    <div class="empty-state">
                        <h2>No mods installed</h2>
                        <p>Install a mod from a ZIP file to see it here.</p>
                    </div>
                </section>
            </template>
        </main>

        <section
            id="add-mod-popover"
            class="add-mod-popover"
            popover="auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-mod-title"
            aria-describedby="add-mod-description"
        >
            <header class="add-mod-header">
                <div>
                    <p class="add-mod-label">Import</p>
                    <h2 id="add-mod-title">Add mods</h2>
                </div>

                <button
                    class="close-dialog-button"
                    type="button"
                    aria-label="Close add mods dialog"
                    popovertarget="add-mod-popover"
                    popovertargetaction="hide"
                >
                    <span class="close-icon" aria-hidden="true"></span>
                </button>
            </header>

            <p id="add-mod-description" class="add-mod-description">
                Import one mod, or select several files and add them together.
            </p>

            <div class="import-options">
                <button
                    class="import-option"
                    type="button"
                    data-import-mode="single"
                    :disabled="isSelectingMods"
                    @click="selectModSources('single')"
                >
                    <span class="import-option-icon" aria-hidden="true">
                        <ImportFileIcon class="import-file-icon" />
                    </span>
                    <span class="import-option-copy">
                        <strong>Import one mod</strong>
                        <small>Select a single mod file.</small>
                    </span>
                    <span class="import-option-arrow" aria-hidden="true"></span>
                </button>

                <button
                    class="import-option"
                    type="button"
                    data-import-mode="batch"
                    :disabled="isSelectingMods"
                    @click="selectModSources('batch')"
                >
                    <span class="import-option-icon" aria-hidden="true">
                        <ImportFilesIcon class="import-file-icon" />
                    </span>
                    <span class="import-option-copy">
                        <strong>Batch import</strong>
                        <small>Select multiple mod files at once.</small>
                    </span>
                    <span class="import-option-arrow" aria-hidden="true"></span>
                </button>
            </div>

            <p
                v-if="importMessage"
                class="import-feedback"
                :class="{ 'import-feedback--error': importFailed }"
                role="status"
                aria-live="polite"
            >
                {{ importMessage }}
            </p>

            <div class="supported-files">
                <p>Supported files</p>
                <span>ZIP archives</span>
                <span>Unity AssetBundles</span>
            </div>
        </section>
    </div>
</template>

<style scoped>
.app-shell {
    display: grid;
    width: 100%;
    max-width: 100vw;
    min-height: 100vh;
    grid-template-columns: clamp(190px, 18vw, 230px) minmax(0, 1fr);
    overflow-x: hidden;
    color: #f2eee5;
    background: #090b0a;
}

.sidebar {
    display: flex;
    min-width: 0;
    flex-direction: column;
    padding: 28px 18px 22px;
    border-right: 1px solid #292e2b;
    background: #0c0e0d;
}

.main-navigation {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.navigation-item {
    position: relative;
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-radius: 7px;
    color: #a9ada7;
    background: transparent;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
}

.navigation-item:hover {
    color: #f2eee5;
    background: #141816;
}

.navigation-item--active {
    color: #f2eee5;
    background: #181c1a;
}

.navigation-item--active::before {
    position: absolute;
    top: 11px;
    bottom: 11px;
    left: 0;
    width: 3px;
    border-radius: 2px;
    background: #86aec7;
    content: "";
}

.navigation-item:focus-visible,
.add-mod-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.main-content {
    display: flex;
    min-width: 0;
    flex-direction: column;
    padding: clamp(32px, 5vw, 64px);
}

.content-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 28px;
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
    font-size: 14px;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease;
}

.add-mod-button:hover {
    background: #9bbfd5;
}

.add-mod-button:active {
    transform: translateY(1px);
}

.add-mod-symbol {
    font-size: 21px;
    font-weight: 400;
    line-height: 1;
}

.add-mod-popover {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    margin: auto;
    padding: 0;
    overflow: auto;
    border: 1px solid #343936;
    border-radius: 14px;
    color: #f2eee5;
    background: #0c0e0d;
    box-shadow: 0 22px 60px rgb(0 0 0 / 45%);
}

.add-mod-popover:popover-open {
    animation: add-mod-popover-in 160ms ease-out;
}

.add-mod-popover::backdrop {
    background: rgb(0 0 0 / 72%);
}

.add-mod-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 26px 28px 0;
}

.add-mod-label {
    margin: 0 0 4px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

.add-mod-header h2 {
    margin: 0;
    color: #f2eee5;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.015em;
}

.close-dialog-button {
    display: inline-flex;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 7px;
    color: #9da19b;
    background: transparent;
    cursor: pointer;
}

.close-dialog-button:hover {
    color: #f2eee5;
    background: #181c1a;
}

.close-icon {
    position: relative;
    width: 16px;
    height: 16px;
}

.close-icon::before,
.close-icon::after {
    position: absolute;
    top: 7px;
    left: 1px;
    width: 14px;
    height: 2px;
    border-radius: 1px;
    background: currentColor;
    content: "";
}

.close-icon::before {
    transform: rotate(45deg);
}

.close-icon::after {
    transform: rotate(-45deg);
}

.add-mod-description {
    margin: 16px 28px 22px;
    color: #aeb1ab;
    font-size: 15px;
    line-height: 1.55;
}

.import-options {
    display: grid;
    gap: 9px;
    padding: 0 20px;
}

.import-option {
    display: grid;
    min-width: 0;
    grid-template-columns: 44px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 14px;
    padding: 15px;
    border: 0;
    border-radius: 9px;
    color: #dedad1;
    background: #121513;
    text-align: left;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
}

.import-option:hover {
    color: #f2eee5;
    background: #182126;
}

.import-option:disabled {
    cursor: wait;
    opacity: 0.55;
}

.import-option-icon {
    display: inline-flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: #9bc2d9;
    background: #1a2429;
}

.import-file-icon {
    width: 26px;
    height: 26px;
}

.import-option-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
}

.import-option-copy strong {
    font-size: 15px;
    font-weight: 650;
}

.import-option-copy small {
    color: #8f948e;
    font-size: 13px;
}

.import-option-arrow {
    justify-self: center;
    width: 8px;
    height: 8px;
    border-top: 2px solid #777d78;
    border-right: 2px solid #777d78;
    transform: rotate(45deg);
}

.import-option:hover .import-option-arrow {
    border-color: #b7d2e1;
}

.supported-files {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin: 22px 28px 26px;
}

.import-feedback {
    margin: 16px 28px 0;
    color: #aeb4ae;
    font-size: 13px;
    line-height: 1.5;
}

.import-feedback--error {
    color: #efa3a3;
}

.supported-files p {
    width: 100%;
    margin: 0 0 2px;
    color: #858a84;
    font-size: 12px;
    font-weight: 600;
}

.supported-files span {
    padding: 5px 9px;
    border-radius: 5px;
    color: #aeb4ae;
    background: #161a17;
    font-size: 12px;
    font-weight: 600;
}

@keyframes add-mod-popover-in {
    from {
        opacity: 0;
        transform: translateY(8px) scale(0.985);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.mods-content {
    display: flex;
    min-height: 360px;
    flex: 1;
    align-items: center;
    justify-content: center;
    border-top: 1px solid #292e2b;
}

.empty-state {
    max-width: 380px;
    padding: 42px 24px;
    text-align: center;
}

.empty-state h2 {
    margin: 0;
    color: #e4e0d7;
    font-size: 21px;
    font-weight: 650;
}

.empty-state p {
    margin: 10px 0 0;
    color: #979b95;
    font-size: 15px;
    line-height: 1.55;
}

@media (max-width: 720px) {
    .app-shell {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
    }

    .sidebar {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 12px 18px;
        border-right: 0;
        border-bottom: 1px solid #292e2b;
    }

    .main-navigation {
        flex-direction: row;
    }

    .navigation-item {
        min-height: 40px;
        padding: 0 13px;
    }

    .navigation-item--active::before {
        top: auto;
        right: 13px;
        bottom: 0;
        left: 13px;
        width: auto;
        height: 3px;
    }

    .main-content {
        padding: clamp(26px, 7vw, 48px);
    }
}

@media (max-width: 480px) {
    .content-header {
        align-items: stretch;
        flex-direction: column;
        gap: 22px;
    }

    .add-mod-button {
        width: 100%;
    }

    .add-mod-header {
        padding: 22px 22px 0;
    }

    .add-mod-description {
        margin-right: 22px;
        margin-left: 22px;
    }

    .import-options {
        padding: 0 14px;
    }

    .supported-files {
        margin-right: 22px;
        margin-left: 22px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .navigation-item,
    .add-mod-button,
    .import-option {
        transition: none;
    }

    .add-mod-popover:popover-open {
        animation: none;
    }
}
</style>
