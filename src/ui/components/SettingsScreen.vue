<script setup lang="ts">
import type { GameLocationChangeProgress } from "../../shared/setup.ts";

import { ErrorUtils } from "@/utils/ErrorUtils.ts";
import { useModStore } from "@/stores/modStore.ts";
import { onMounted, ref } from "vue";

const modStore = useModStore();

const gameLocation = ref("");
const pluginVersion = ref("");
const pendingGameLocation = ref("");
const gameLocationError = ref("");
const gameLocationChangeError = ref("");
const isSelectingGameLocation = ref(false);
const isChangingGameLocation = ref(false);
const gameLocationProgress = ref<GameLocationChangeProgress | null>(null);
const isOpeningGameLocation = ref(false);

async function loadGameSettings() {
    gameLocationError.value = "";

    try
    {
        const state = await window.app.getSetupState();

        gameLocation.value = state.gameLocation ?? "";
        pluginVersion.value = state.pluginVersion ?? "";
    }
    catch (error)
    {
        console.error("Could not load the game settings:", error);
        gameLocationError.value = ErrorUtils.getUserErrorMessage(error, "The game settings could not be loaded.");
    }
}

async function selectGameLocation(manualSetup: boolean) {
    if (isSelectingGameLocation.value || isChangingGameLocation.value)
        return;

    isSelectingGameLocation.value = true;
    gameLocationError.value = "";
    gameLocationChangeError.value = "";

    try
    {
        const result = await window.app.selectGameLocation(manualSetup);
        if (result.canceled)
            return;

        if (!result.success)
        {
            gameLocationError.value = result.message;
            return;
        }

        pendingGameLocation.value = result.path;
        confirmationPopover()?.showPopover();
    }
    catch (error)
    {
        console.error("Could not select the game location:", error);
        gameLocationError.value = ErrorUtils.getUserErrorMessage(error, "The game location could not be selected.");
    }
    finally
    {
        isSelectingGameLocation.value = false;
    }
}

async function confirmGameLocationChange() {
    if (!pendingGameLocation.value || isChangingGameLocation.value)
        return;

    isChangingGameLocation.value = true;
    gameLocationChangeError.value = "";
    gameLocationProgress.value = {
        progress: 0,
        status: "Preparing the installation…",
        detail: pendingGameLocation.value
    };

    const removeProgressListener = window.app.onGameLocationChangeProgress((progress) => {
        gameLocationProgress.value = progress;
    });

    try
    {
        const result = await window.app.changeGameLocation(pendingGameLocation.value);
        if (!result.success)
        {
            gameLocationChangeError.value = result.message;
            return;
        }

        gameLocation.value = result.gameLocation ?? pendingGameLocation.value;
        pluginVersion.value = result.pluginVersion ?? pluginVersion.value;

        confirmationPopover()?.hidePopover();
        pendingGameLocation.value = "";

        await modStore.load(true);
    }
    catch (error)
    {
        console.error("Could not change the game location:", error);
        gameLocationChangeError.value = ErrorUtils.getUserErrorMessage(error, "The game location could not be changed.");
    }
    finally
    {
        removeProgressListener();
        isChangingGameLocation.value = false;
        gameLocationProgress.value = null;
    }
}

async function openGameLocation() {
    if (!gameLocation.value || isOpeningGameLocation.value || isSelectingGameLocation.value || isChangingGameLocation.value)
        return;

    isOpeningGameLocation.value = true;
    gameLocationError.value = "";

    try
    {
        await window.app.openGameLocation();
    }
    catch (error)
    {
        console.error("Could not open the game folder:", error);
        gameLocationError.value = ErrorUtils.getUserErrorMessage(error, "The game folder could not be opened.");
    }
    finally
    {
        isOpeningGameLocation.value = false;
    }
}

function confirmationPopover(): HTMLElement | null {
    return document.getElementById("game-location-confirmation-popover");
}

function cancelGameLocationChange() {
    if (isChangingGameLocation.value)
        return;

    confirmationPopover()?.hidePopover();

    pendingGameLocation.value = "";
    gameLocationChangeError.value = "";
    gameLocationProgress.value = null;
}

onMounted(loadGameSettings);
</script>

<template>
    <section class="settings-view" aria-labelledby="settings-title">
        <header class="settings-header">
            <div>
                <p class="content-label">Configuration</p>
                <h1 id="settings-title">Settings</h1>
            </div>
        </header>

        <div class="settings-content">
            <section class="settings-section" aria-labelledby="game-settings-title">
                <header class="section-heading">
                    <div>
                        <h2 id="game-settings-title">Game</h2>
                        <p>Manage the Last Origin R+ installation used by the mod manager.</p>
                    </div>
                </header>

                <div class="settings-list">
                    <div class="setting-row setting-row--stacked">
                        <div class="setting-copy">
                            <div class="setting-title-line">
                                <h3>Game location</h3>
                                <span
                                    v-if="gameLocation"
                                    class="status-chip status-chip--success"
                                >
                                    Valid installation
                                </span>
                            </div>
                            <p>The folder containing the Last Origin R+ executable.</p>
                        </div>

                        <div
                            class="path-field"
                            aria-label="Selected game location"
                            :title="gameLocation || undefined"
                        >
                            <span>{{ gameLocation || "No game location selected" }}</span>
                        </div>

                        <div class="setting-actions">
                            <button
                                class="settings-button settings-button--secondary"
                                type="button"
                                :disabled="isSelectingGameLocation || isChangingGameLocation"
                                @click="selectGameLocation(false)"
                            >
                                Auto-detect
                            </button>
                            <button
                                class="settings-button settings-button--secondary"
                                type="button"
                                :disabled="isSelectingGameLocation || isChangingGameLocation"
                                @click="selectGameLocation(true)"
                            >
                                Choose folder
                            </button>
                            <button
                                class="settings-button settings-button--quiet"
                                type="button"
                                :disabled="
                                    !gameLocation ||
                                    isOpeningGameLocation ||
                                    isSelectingGameLocation ||
                                    isChangingGameLocation
                                "
                                @click="openGameLocation"
                            >
                                Open folder
                            </button>
                        </div>

                        <p v-if="gameLocationError" class="setting-error" role="alert">
                            {{ gameLocationError }}
                        </p>
                    </div>

                    <div class="setting-row">
                        <div class="setting-copy">
                            <div class="setting-title-line">
                                <h3>LOPlugin+</h3>
                                <span class="status-chip status-chip--success">Installed</span>
                            </div>
                            <p>
                                Installed version
                                <span class="setting-value">{{ pluginVersion || "Unknown" }}</span>
                            </p>
                        </div>

                        <div class="setting-actions">
                            <button class="settings-button settings-button--secondary" type="button">
                                Check for update
                            </button>
                            <button class="settings-button settings-button--quiet" type="button">
                                Reinstall
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section class="settings-section" aria-labelledby="update-settings-title">
                <header class="section-heading section-heading--with-action">
                    <div>
                        <h2 id="update-settings-title">Updates</h2>
                        <p>Choose which components should be checked automatically.</p>
                    </div>

                    <button class="settings-button settings-button--primary" type="button">
                        Check for updates
                    </button>
                </header>

                <div class="settings-list">
                    <label class="setting-row setting-row--toggle">
                        <span class="setting-copy">
                            <span class="setting-title-line">
                                <strong>Application updates</strong>
                                <span class="version-text">Version 1.0.0</span>
                            </span>
                            <span class="setting-description">
                                Check for new mod manager releases when the application starts.
                            </span>
                        </span>

                        <span class="switch-control">
                            <input type="checkbox" checked />
                            <span class="switch-track" aria-hidden="true">
                                <span class="switch-thumb"></span>
                            </span>
                        </span>
                    </label>

                    <label class="setting-row setting-row--toggle">
                        <span class="setting-copy">
                            <span class="setting-title-line">
                                <strong>LOPlugin+ updates</strong>
                                <span class="version-text">Version 1.3.8.1</span>
                            </span>
                            <span class="setting-description">
                                Check whether a newer plugin release is available.
                            </span>
                        </span>

                        <span class="switch-control">
                            <input type="checkbox" checked />
                            <span class="switch-track" aria-hidden="true">
                                <span class="switch-thumb"></span>
                            </span>
                        </span>
                    </label>

                    <label class="setting-row setting-row--toggle">
                        <span class="setting-copy">
                            <span class="setting-title-line">
                                <strong>Character catalog updates</strong>
                                <span class="version-text">Catalog 1.4.2</span>
                            </span>
                            <span class="setting-description">
                                Keep character, skin and asset information up to date.
                            </span>
                        </span>

                        <span class="switch-control">
                            <input type="checkbox" checked />
                            <span class="switch-track" aria-hidden="true">
                                <span class="switch-thumb"></span>
                            </span>
                        </span>
                    </label>
                </div>

                <p class="last-checked">Updates have not been checked yet.</p>
            </section>

            <section class="settings-section" aria-labelledby="maintenance-settings-title">
                <header class="section-heading">
                    <div>
                        <h2 id="maintenance-settings-title">Storage &amp; maintenance</h2>
                        <p>Inspect local files and clean data the application no longer needs.</p>
                    </div>
                </header>

                <div class="storage-summary" aria-label="Mod storage usage">
                    <div>
                        <span>Imported mod library</span>
                        <strong>Calculating storage usage…</strong>
                    </div>
                    <span class="storage-location">Stored in the application data folder</span>
                </div>

                <div class="settings-list">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <h3>Mod library folder</h3>
                            <p>Open the folder containing all imported mods.</p>
                        </div>

                        <button class="settings-button settings-button--secondary" type="button">
                            Open folder
                        </button>
                    </div>

                    <div class="setting-row">
                        <div class="setting-copy">
                            <h3>Temporary files</h3>
                            <p>Remove leftover downloads and temporary import data.</p>
                        </div>

                        <button class="settings-button settings-button--secondary" type="button">
                            Clean temporary files
                        </button>
                    </div>

                    <div class="setting-row">
                        <div class="setting-copy">
                            <h3>Application logs</h3>
                            <p>Open diagnostic logs that can help investigate errors.</p>
                        </div>

                        <button class="settings-button settings-button--quiet" type="button">
                            Open log folder
                        </button>
                    </div>
                </div>
            </section>
        </div>
    </section>

    <section
        id="game-location-confirmation-popover"
        class="confirmation-popover"
        popover="manual"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-location-confirmation-title"
        aria-describedby="game-location-confirmation-description"
    >
        <template v-if="!isChangingGameLocation">
            <header class="confirmation-header">
                <p class="confirmation-label">Change game location</p>
                <h2 id="game-location-confirmation-title">
                    Reinstall LOPlugin+ in this folder?
                </h2>
            </header>

            <p id="game-location-confirmation-description" class="confirmation-description">
                Changing the game location requires a clean LOPlugin+ and BepInEx installation.
                Back up anything in the destination installation that you want to keep before continuing.
            </p>

            <div class="confirmation-path">
                <span>New game location</span>
                <strong :title="pendingGameLocation">{{ pendingGameLocation }}</strong>
            </div>

            <ul class="confirmation-effects">
                <li>
                    Every synchronized mod will be removed from the current game location.
                </li>
                <li class="confirmation-effect--warning">
                    The destination’s existing BepInEx folder and loader files will be deleted and replaced.
                </li>
                <li>
                    The latest LOPlugin+ release, including BepInEx, will be installed in the selected folder.
                </li>
                <li>
                    Imported mods stored by the mod manager will not be deleted.
                </li>
            </ul>

            <p v-if="gameLocationChangeError" class="confirmation-error" role="alert">
                {{ gameLocationChangeError }}
            </p>

            <footer class="confirmation-actions">
                <button
                    class="settings-button settings-button--secondary"
                    type="button"
                    @click="cancelGameLocationChange"
                >
                    Cancel
                </button>
                <button
                    class="settings-button settings-button--danger"
                    type="button"
                    @click="confirmGameLocationChange"
                >
                    Reinstall and change location
                </button>
            </footer>
        </template>

        <div v-else class="location-progress" aria-live="polite" aria-busy="true">
            <header class="confirmation-header">
                <p class="confirmation-label">Changing game location</p>
                <h2>Preparing the selected installation</h2>
            </header>

            <div class="location-progress-copy">
                <strong>{{ gameLocationProgress?.status || "Preparing…" }}</strong>
                <span>{{ gameLocationProgress?.detail || pendingGameLocation }}</span>
            </div>

            <div
                class="location-progress-track"
                role="progressbar"
                aria-label="Game location change progress"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(gameLocationProgress?.progress || 0)"
            >
                <span
                    class="location-progress-fill"
                    :style="{ width: `${gameLocationProgress?.progress || 0}%` }"
                ></span>
            </div>

            <span class="location-progress-percent">
                {{ Math.round(gameLocationProgress?.progress || 0) }}%
            </span>
        </div>
    </section>
</template>

<style scoped>
.settings-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
}

.settings-header {
    flex: 0 0 auto;
    padding-bottom: 28px;
    border-bottom: 1px solid #292e2b;
}

.content-label {
    margin: 0 0 6px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

h1,
h2,
h3,
p {
    margin: 0;
}

h1 {
    color: #f2eee5;
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(34px, 4vw, 44px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
}

.settings-content {
    min-height: 0;
    padding: 0 8px 40px 0;
    overflow-y: auto;
}

.settings-section {
    padding: 28px 0;
    border-bottom: 1px solid #252a27;
}

.settings-section:last-child {
    border-bottom: 0;
}

.section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 16px;
}

.section-heading--with-action {
    align-items: center;
}

.section-heading h2 {
    color: #f2eee5;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
}

.section-heading p {
    margin-top: 5px;
    color: #909791;
    font-size: 13px;
    line-height: 1.55;
}

.settings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.setting-row {
    display: flex;
    min-width: 0;
    min-height: 76px;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
    padding: 16px 18px;
    border-radius: 8px;
    background: #101411;
}

.setting-row--stacked {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
}

.setting-row--toggle {
    cursor: pointer;
}

.setting-row--toggle:hover {
    background: #121714;
}

.setting-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 4px;
}

.setting-copy h3,
.setting-copy strong {
    color: #e8e4dc;
    font-size: 14px;
    font-weight: 650;
    line-height: 1.4;
}

.setting-copy p,
.setting-description {
    color: #8f9690;
    font-size: 13px;
    line-height: 1.5;
}

.setting-title-line {
    display: flex;
    min-width: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.setting-value,
.version-text {
    color: #9ebdcb;
}

.version-text {
    font-size: 12px;
    font-weight: 600;
}

.status-chip {
    display: inline-flex;
    min-height: 24px;
    align-items: center;
    padding: 3px 9px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
}

.status-chip--success {
    color: #a7d2bf;
    background: #14241d;
}

.path-field {
    display: flex;
    min-width: 0;
    min-height: 44px;
    align-items: center;
    padding: 0 13px;
    overflow: hidden;
    border: 1px solid #303632;
    border-radius: 6px;
    color: #a7ada8;
    background: #0b0e0c;
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 12px;
}

.path-field span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.setting-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.settings-button {
    min-height: 40px;
    padding: 0 15px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease;
}

.settings-button--primary {
    color: #0c151a;
    background: #91b8cf;
}

.settings-button--primary:hover {
    background: #a1c4d7;
}

.settings-button--secondary {
    color: #e9e5dd;
    background: #1a1f1c;
}

.settings-button--secondary:hover,
.settings-button--quiet:hover {
    color: #f6f2e9;
    background: #242a26;
}

.settings-button--quiet {
    color: #aeb4af;
    background: transparent;
}

.settings-button--danger {
    color: #f4d5d1;
    background: #542d2b;
}

.settings-button--danger:hover {
    background: #653633;
}

.settings-button:disabled {
    color: #656b67;
    background: #171a18;
    cursor: not-allowed;
}

.settings-button:focus-visible,
.setting-row--toggle:has(input:focus-visible) {
    outline: 2px solid #9bc2d9;
    outline-offset: 2px;
}

.switch-control {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
}

.switch-control input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
}

.switch-track {
    position: relative;
    display: block;
    width: 42px;
    height: 24px;
    border: 1px solid #3b423e;
    border-radius: 12px;
    background: #171b19;
    transition: border-color 140ms ease, background-color 140ms ease;
}

.switch-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #8c938e;
    transition: background-color 140ms ease, transform 140ms ease;
}

.switch-control input:checked + .switch-track {
    border-color: #7199af;
    background: #213844;
}

.switch-control input:checked + .switch-track .switch-thumb {
    background: #a6cade;
    transform: translateX(18px);
}

.last-checked {
    margin-top: 12px;
    color: #747b76;
    font-size: 12px;
    text-align: right;
}

.setting-error,
.confirmation-error {
    color: #ef9c98;
    font-size: 13px;
    line-height: 1.5;
}

.confirmation-popover {
    width: min(590px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    margin: auto;
    padding: 26px;
    overflow-y: auto;
    border: 1px solid #3a403c;
    border-radius: 12px;
    color: #e8e4dc;
    background: #101411;
    box-shadow: 0 22px 60px rgb(0 0 0 / 48%);
}

.confirmation-popover::backdrop {
    background: rgb(3 5 4 / 74%);
}

.confirmation-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.confirmation-label {
    color: #9bc2d9;
    font-size: 12px;
    font-weight: 700;
}

.confirmation-header h2 {
    color: #f2eee5;
    font-size: 23px;
    line-height: 1.25;
}

.confirmation-description {
    margin-top: 14px;
    color: #a7ada8;
    font-size: 14px;
    line-height: 1.6;
}

.confirmation-path {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid #303632;
    border-radius: 7px;
    background: #0b0e0c;
}

.confirmation-path span {
    color: #7f8781;
    font-size: 11px;
    font-weight: 650;
}

.confirmation-path strong {
    overflow: hidden;
    color: #d8d5ce;
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.confirmation-effects {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 18px 0 0;
    padding: 0 0 0 20px;
    color: #abb1ac;
    font-size: 13px;
    line-height: 1.5;
}

.confirmation-effects li::marker {
    color: #8eb9ce;
}

.confirmation-effects .confirmation-effect--warning {
    color: #e6b3ac;
}

.confirmation-effects .confirmation-effect--warning::marker {
    color: #d97f77;
}

.confirmation-error {
    margin-top: 16px;
    padding: 11px 13px;
    border-radius: 6px;
    background: #261817;
}

.confirmation-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 22px;
}

.location-progress {
    display: flex;
    flex-direction: column;
}

.location-progress-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
    margin-top: 22px;
}

.location-progress-copy strong {
    color: #e9e5dd;
    font-size: 14px;
}

.location-progress-copy span {
    overflow: hidden;
    color: #8f9690;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.location-progress-track {
    height: 7px;
    margin-top: 14px;
    overflow: hidden;
    border-radius: 4px;
    background: #242a27;
}

.location-progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #91b8cf;
    transition: width 160ms ease;
}

.location-progress-percent {
    margin-top: 7px;
    color: #9ebdcb;
    font-size: 12px;
    font-weight: 650;
    text-align: right;
}

.storage-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 8px;
    padding: 16px 18px;
    border-radius: 8px;
    color: #e8e4dc;
    background: #111916;
}

.storage-summary div {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.storage-summary span {
    color: #8f9690;
    font-size: 12px;
}

.storage-summary strong {
    font-size: 15px;
    font-weight: 650;
}

.storage-summary .storage-location {
    color: #8eb9ce;
    text-align: right;
}

@media (max-width: 820px) {
    .settings-header {
        padding-bottom: 22px;
    }

    .settings-section {
        padding: 22px 0;
    }

    .section-heading,
    .section-heading--with-action,
    .setting-row,
    .storage-summary {
        align-items: stretch;
        flex-direction: column;
    }

    .section-heading,
    .setting-row,
    .storage-summary {
        gap: 14px;
    }

    .section-heading .settings-button,
    .setting-row > .settings-button {
        align-self: flex-start;
    }

    .setting-row--toggle {
        align-items: center;
        flex-direction: row;
    }

    .storage-summary .storage-location {
        text-align: left;
    }
}

@media (max-width: 540px) {
    .settings-content {
        padding-right: 4px;
    }

    .setting-row,
    .storage-summary {
        padding: 14px;
    }

    .setting-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .setting-actions .settings-button {
        width: 100%;
    }

    .confirmation-popover {
        padding: 20px;
    }

    .confirmation-actions {
        align-items: stretch;
        flex-direction: column-reverse;
    }

    .confirmation-actions .settings-button {
        width: 100%;
    }
}
</style>
