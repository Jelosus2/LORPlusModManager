<script setup lang="ts">
import type { ApplicationInfo, ExternalApplicationPage, ApplicationLogEntry, ApplicationLogSeverity } from "../../shared/application";

import RefreshIcon from "./icons/RefreshIcon.vue";
import SearchIcon from "./icons/SearchIcon.vue";
import FolderIcon from "./icons/FolderIcon.vue";
import GithubIcon from "./icons/GithubIcon.vue";
import CloseIcon from "./icons/CloseIcon.vue";
import TrashIcon from "./icons/TrashIcon.vue";
import KoFiIcon from "./icons/KoFiIcon.vue";
import LogsIcon from "./icons/LogsIcon.vue";

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { ApplicationLogSource } from "../../shared/application";
import { RendererLogger } from "@/utils/RendererLogger.ts";
import { ErrorUtils } from "@/utils/ErrorUtils.ts";

const applicationInfo = ref<ApplicationInfo>({ name: "LORPlusModManager", version: "..." });
const titleBarError = ref("");
const logEntries = ref<ApplicationLogEntry[]>([]);
const logQuery = ref("");
const logSeverity = ref<ApplicationLogSeverity | "all">("all");
const logSource = ref("all");
const logError = ref("");
const isLoadingLogs = ref(false);
const isOpeningLogFilePath = ref(false);

let errorTimeout: number | null = null;

const availableLogSources = computed(() =>
    [...new Set(logEntries.value.map((entry) => entry.source))].sort((left, right) => left.localeCompare(right))
);

const hasActiveLogFilters = computed(() => Boolean(logQuery.value || logSeverity.value !== "all" || logSource.value !== "all"));

const filteredLogEntries = computed(() => {
    const query = logQuery.value.toLocaleLowerCase("en-US");

    return logEntries.value.filter((entry) => {
        if (logSeverity.value !== "all" && entry.severity !== logSeverity.value)
            return false;
        if (logSource.value !== "all" && entry.source !== logSource.value)
            return false;
        if (!query)
            return true;

        return [entry.message, entry.source, entry.details ?? ""].some((value) => value.toLocaleLowerCase("en-US").includes(query));
    });
});

async function loadApplicationInfo() {
    try
    {
        applicationInfo.value = await window.app.getApplicationInfo();
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.application, "Could not load the application information.", error);
        showTitleBarError(ErrorUtils.getUserErrorMessage(error, "The application version could not be loaded."));
    }
}

async function openExternalPage(page: ExternalApplicationPage) {
    try
    {
        await window.app.openExternalPage(page);
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.application, `Could not open external page ${page}.`, error);
        showTitleBarError(ErrorUtils.getUserErrorMessage(error, "The page could not be opened."));
    }
}

async function openCurrentLogFilePath() {
    if (isOpeningLogFilePath.value)
        return;

    isOpeningLogFilePath.value = true;
    logError.value = "";

    try
    {
        await window.app.openCurrentLogFilePath();
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.diagnostics, "Could not open the current session log file path.", error);
        logError.value = ErrorUtils.getUserErrorMessage(error, "The current session log file could not be shown.");
    }
    finally
    {
        isOpeningLogFilePath.value = false;
    }
}

async function loadApplicationLogs() {
    if (isLoadingLogs.value)
        return;

    isLoadingLogs.value = true;
    logError.value = "";

    try
    {
        logEntries.value = [...await window.app.getApplicationLogs()];
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.diagnostics, "Could not load the application logs.", error);
        logError.value = ErrorUtils.getUserErrorMessage(error, "The application logs could not be loaded.");
    }
    finally
    {
        isLoadingLogs.value = false;
    }
}

function logsPopover(): HTMLElement | null {
    return document.getElementById("application-logs-popover");
}

function showLogs() {
    logError.value = "";
    logsPopover()?.showPopover();
    void loadApplicationLogs();
}

function closeLogs() {
    logsPopover()?.hidePopover();
}

function clearLogFilters() {
    logQuery.value = "";
    logSeverity.value = "all";
    logSource.value = "all";
}

function clearDisplayedLogs() {
    logEntries.value = [];
    logError.value = "";
    clearLogFilters();
}

function showTitleBarError(message: string) {
    titleBarError.value = message;

    if (errorTimeout !== null)
        window.clearTimeout(errorTimeout);

    errorTimeout = window.setTimeout(() => {
        titleBarError.value = "";
        errorTimeout = null;
    }, 7000);
}

function formatLogSeverity(severity: ApplicationLogSeverity): string {
    switch (severity)
    {
        case "debug":
            return "Debug";
        case "info":
            return "Info";
        case "warning":
            return "Warning";
        case "error":
            return "Error";
    }
}

function formatLogTimestamp(timestamp: string): string {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime()))
        return timestamp;

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium"
    }).format(date);
}

onMounted(loadApplicationInfo);

onBeforeUnmount(() => {
    if (errorTimeout !== null)
        window.clearTimeout(errorTimeout);
});
</script>

<template>
    <header class="app-titlebar">
        <div class="titlebar-brand" aria-label="Application information">
            <img
                class="titlebar-app-icon"
                src="../assets/app-icon.png"
                alt=""
                aria-hidden="true"
                draggable="false"
            />
            <strong>{{ applicationInfo.name }}</strong>
            <span class="titlebar-version">v{{ applicationInfo.version }}</span>
        </div>

        <nav class="titlebar-actions" aria-label="Application links and tools">
            <button
                class="titlebar-action titlebar-action--support"
                type="button"
                title="Support my work on Ko-Fi"
                @click="openExternalPage('support')"
            >
                <KoFiIcon class="titlebar-icon titlebar-icon--kofi" />
                <span>Support my work</span>
            </button>

            <button
                class="titlebar-action"
                type="button"
                title="Open the project on GitHub"
                @click="openExternalPage('repository')"
            >
                <GithubIcon class="titlebar-icon titlebar-icon--github" />
                <span>GitHub</span>
            </button>

            <button
                class="titlebar-action"
                type="button"
                title="View application logs"
                @click="showLogs"
            >
                <LogsIcon class="titlebar-icon" />
                <span>Logs</span>
            </button>
        </nav>
    </header>

    <div v-if="titleBarError" class="titlebar-error" role="alert">
        <span>{{ titleBarError }}</span>
        <button type="button" aria-label="Dismiss error" @click="titleBarError = ''">
            <CloseIcon />
        </button>
    </div>

    <section
        id="application-logs-popover"
        class="logs-popover"
        popover="manual"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-logs-title"
    >
        <header class="logs-header">
            <div>
                <p class="logs-label">Diagnostics</p>
                <h2 id="application-logs-title">Application logs</h2>
                <p>Review activity and errors reported by the mod manager.</p>
            </div>

            <button
                class="logs-close-button"
                type="button"
                aria-label="Close application logs"
                @click="closeLogs"
            >
                <CloseIcon />
            </button>
        </header>

        <div class="logs-toolbar">
            <label class="logs-search">
                <span class="logs-control-label">Search</span>
                <span class="logs-input-shell">
                    <SearchIcon aria-hidden="true" />
                    <input
                        v-model.trim="logQuery"
                        type="search"
                        placeholder="Message or source"
                        autocomplete="off"
                    />
                </span>
            </label>

            <label class="logs-filter">
                <span class="logs-control-label">Severity</span>
                <select v-model="logSeverity">
                    <option value="all">All severities</option>
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                </select>
            </label>

            <label class="logs-filter">
                <span class="logs-control-label">Source</span>
                <select v-model="logSource" :disabled="availableLogSources.length === 0">
                    <option value="all">All sources</option>
                    <option v-for="source in availableLogSources" :key="source" :value="source">
                        {{ source }}
                    </option>
                </select>
            </label>

            <button
                class="logs-clear-filters"
                type="button"
                :disabled="!hasActiveLogFilters"
                @click="clearLogFilters"
            >
                Clear filters
            </button>
        </div>

        <div class="logs-results-heading">
            <span>
                {{ filteredLogEntries.length }}
                {{ filteredLogEntries.length === 1 ? "entry" : "entries" }}
            </span>
            <span v-if="logEntries.length !== filteredLogEntries.length">
                of {{ logEntries.length }} total
            </span>
        </div>

        <p v-if="logError" class="logs-error" role="alert">{{ logError }}</p>

        <section class="logs-viewport" :aria-busy="isLoadingLogs">
            <div v-if="isLoadingLogs" class="logs-empty-state">
                <span class="logs-loading-spinner" aria-hidden="true"></span>
                <strong>Loading logs</strong>
                <p>Reading the latest application activity…</p>
            </div>

            <div v-else-if="filteredLogEntries.length === 0" class="logs-empty-state">
                <LogsIcon aria-hidden="true" />
                <strong>{{ logEntries.length === 0 ? "No logs available" : "No matching logs" }}</strong>
                <p>
                    {{
                        logEntries.length === 0
                            ? "Log entries will appear here once application logging is enabled."
                            : "Try changing or clearing the current filters."
                    }}
                </p>
            </div>

            <div v-else class="logs-list">
                <article
                    v-for="entry in filteredLogEntries"
                    :key="entry.id"
                    class="log-entry"
                    :class="`log-entry--${entry.severity}`"
                >
                    <span class="log-severity-indicator" aria-hidden="true"></span>

                    <div class="log-entry-content">
                        <header>
                            <span class="log-severity">{{ formatLogSeverity(entry.severity) }}</span>
                            <span class="log-source">{{ entry.source }}</span>
                            <time :datetime="entry.timestamp">
                                {{ formatLogTimestamp(entry.timestamp) }}
                            </time>
                        </header>

                        <p>{{ entry.message }}</p>
                        <pre v-if="entry.details">{{ entry.details }}</pre>
                    </div>
                </article>
            </div>
        </section>

        <footer class="logs-footer">
            <div class="logs-footer-group">
                <button
                    class="logs-button logs-button--secondary"
                    type="button"
                    title="Open the log folder and select the current session file"
                    :disabled="isOpeningLogFilePath"
                    @click="openCurrentLogFilePath"
                >
                    <FolderIcon />
                    <span>{{ isOpeningLogFilePath ? "Opening…" : "Show current log" }}</span>
                </button>
            </div>

            <div class="logs-footer-group">
                <button
                    class="logs-button logs-button--secondary logs-button--clear"
                    type="button"
                    title="Clear the displayed entries without deleting the log file"
                    :disabled="isLoadingLogs || logEntries.length === 0"
                    @click="clearDisplayedLogs"
                >
                    <TrashIcon />
                    <span>Clear view</span>
                </button>

                <button
                    class="logs-button logs-button--secondary logs-button--refresh"
                    :class="{ 'is-loading': isLoadingLogs }"
                    type="button"
                    title="Reload entries from the current session log"
                    :disabled="isLoadingLogs"
                    @click="loadApplicationLogs"
                >
                    <RefreshIcon />
                    <span>{{ isLoadingLogs ? "Refreshing…" : "Refresh" }}</span>
                </button>

                <button class="logs-button logs-button--primary" type="button" @click="closeLogs">
                    Close
                </button>
            </div>
        </footer>
    </section>
</template>

<style scoped>
.app-titlebar {
    position: relative;
    z-index: 100;
    display: flex;
    width: 100%;
    height: var(--titlebar-height);
    align-items: center;
    padding: 0 138px 0 16px;
    color: #dcd8cf;
    background: #0a0d0b;
    user-select: none;
    -webkit-app-region: drag;
}

.titlebar-brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
}

.titlebar-app-icon {
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    border-radius: 5px;
    object-fit: cover;
}

.titlebar-brand strong {
    overflow: hidden;
    color: #f7f3ea;
    font-size: 13px;
    font-weight: 720;
    text-overflow: ellipsis;
}

.titlebar-version {
    padding: 3px 7px;
    border: 1px solid #27404d;
    border-radius: 5px;
    color: #b1d5e8;
    background: #14232b;
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1.35;
}

.titlebar-actions {
    display: flex;
    height: 100%;
    align-items: stretch;
    margin-left: auto;
    -webkit-app-region: no-drag;
}

.titlebar-action {
    display: inline-flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 14px;
    border: 0;
    border-left: 1px solid #202622;
    color: #d3d1ca;
    background: #0d110f;
    font: inherit;
    font-size: 12px;
    font-weight: 680;
    cursor: pointer;
    transition: color 120ms ease, background-color 120ms ease;
}

.titlebar-action:hover {
    color: #fffaf0;
    background: #1a201d;
}

.titlebar-action:last-child {
    border-right: 1px solid #202622;
}

.titlebar-action--support {
    color: #f0b4aa;
    background: #15100f;
}

.titlebar-action--support:hover {
    color: #ffd8d0;
    background: #2a1917;
}

.titlebar-action:focus-visible,
.logs-close-button:focus-visible,
.logs-button:focus-visible,
.logs-clear-filters:focus-visible,
.logs-input-shell:focus-within,
.logs-filter select:focus-visible {
    outline: 2px solid #93bdd4;
    outline-offset: -2px;
}

.titlebar-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.titlebar-icon--github {
    stroke: none;
}

.titlebar-icon--kofi {
    stroke: none;
}

.titlebar-error {
    position: fixed;
    z-index: 110;
    top: calc(var(--titlebar-height) + 10px);
    left: 50%;
    display: flex;
    width: min(580px, calc(100vw - 28px));
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 13px;
    border: 1px solid #613b39;
    border-radius: 7px;
    color: #efaaa6;
    background: #271716;
    box-shadow: 0 14px 36px rgb(0 0 0 / 38%);
    font-size: 12px;
    line-height: 1.45;
    transform: translateX(-50%);
    -webkit-app-region: no-drag;
}

.titlebar-error button {
    display: inline-flex;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    color: #d99d99;
    background: transparent;
    cursor: pointer;
}

.titlebar-error svg,
.logs-close-button svg,
.logs-button svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.logs-popover {
    display: none;
    width: min(1120px, calc(100vw - 40px));
    height: min(760px, calc(100vh - 60px));
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid #38403b;
    border-radius: 12px;
    color: #e9e5dc;
    background: #0e1210;
    box-shadow: 0 28px 90px rgb(0 0 0 / 58%);
    flex-direction: column;
    -webkit-app-region: no-drag;
}

.logs-popover:popover-open {
    display: flex;
}

.logs-popover::backdrop {
    background: rgb(3 5 4 / 76%);
}

.logs-header {
    display: flex;
    min-height: 108px;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding: 24px 26px 20px;
    border-bottom: 1px solid #29302c;
}

.logs-label {
    margin: 0 0 4px;
    color: #8eb7cf;
    font-size: 12px;
    font-weight: 700;
}

.logs-header h2 {
    margin: 0;
    color: #f1eee6;
    font-size: 25px;
    line-height: 1.2;
}

.logs-header p:last-child {
    margin: 7px 0 0;
    color: #969d98;
    font-size: 13px;
}

.logs-close-button {
    display: inline-flex;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: #aeb4af;
    background: #171c19;
    cursor: pointer;
}

.logs-close-button:hover {
    color: #f2eee5;
    background: #202622;
}

.logs-toolbar {
    display: grid;
    min-height: 92px;
    align-items: end;
    gap: 10px;
    padding: 15px 26px 17px;
    border-bottom: 1px solid #29302c;
    grid-template-columns: minmax(260px, 1fr) minmax(160px, 210px) minmax(160px, 210px) auto;
}

.logs-search,
.logs-filter {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
}

.logs-filter {
    position: relative;
}

.logs-filter::after {
    position: absolute;
    right: 16px;
    bottom: 17px;
    width: 7px;
    height: 7px;
    border-right: 2px solid #a9ada7;
    border-bottom: 2px solid #a9ada7;
    content: "";
    pointer-events: none;
    transform: rotate(45deg);
}

.logs-filter:has(select:disabled)::after {
    border-color: #59605c;
}

.logs-control-label {
    color: #8f9892;
    font-size: 11px;
    font-weight: 650;
}

.logs-input-shell {
    display: flex;
    min-width: 0;
    height: 40px;
    align-items: center;
    gap: 9px;
    padding: 0 12px;
    border: 1px solid #343b37;
    border-radius: 6px;
    color: #8d9691;
    background: #0a0d0b;
}

.logs-input-shell svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
}

.logs-input-shell input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    color: #e3dfd6;
    background: transparent;
    font: inherit;
    font-size: 12px;
}

.logs-input-shell input::placeholder {
    color: #737b76;
}

.logs-filter select {
    width: 100%;
    height: 40px;
    padding: 0 42px 0 12px;
    border: 1px solid #343b37;
    border-radius: 6px;
    color: #dcd8cf;
    background-color: #0a0d0b;
    font: inherit;
    font-size: 12px;
    appearance: none;
    color-scheme: dark;
    cursor: pointer;
}

.logs-filter select:disabled {
    color: #666d69;
    cursor: not-allowed;
}

.logs-clear-filters {
    height: 40px;
    padding: 0 13px;
    border: 0;
    border-radius: 6px;
    color: #9dc5da;
    background: transparent;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
}

.logs-clear-filters:hover:not(:disabled) {
    background: #172027;
}

.logs-clear-filters:disabled {
    color: #59605c;
    cursor: not-allowed;
}

.logs-results-heading {
    display: flex;
    height: 36px;
    align-items: center;
    gap: 5px;
    padding: 0 26px;
    color: #94a09a;
    font-size: 11px;
}

.logs-error {
    margin: 0 26px 10px;
    padding: 10px 12px;
    border-radius: 6px;
    color: #efa5a1;
    background: #291817;
    font-size: 12px;
}

.logs-viewport {
    height: auto;
    min-height: 180px;
    flex: 1;
    margin: 0 26px;
    overflow-y: auto;
    border: 1px solid #2b322e;
    border-radius: 8px;
    background: #090c0a;
}

.logs-empty-state {
    display: flex;
    height: 100%;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 28px;
    text-align: center;
}

.logs-empty-state > svg {
    width: 34px;
    height: 34px;
    margin-bottom: 13px;
    fill: none;
    stroke: #708078;
    stroke-width: 1.5;
}

.logs-empty-state strong {
    color: #d8d5cd;
    font-size: 14px;
}

.logs-empty-state p {
    max-width: 410px;
    margin: 6px 0 0;
    color: #818a84;
    font-size: 12px;
    line-height: 1.55;
}

.logs-loading-spinner {
    width: 24px;
    height: 24px;
    margin-bottom: 14px;
    border: 3px solid #27302b;
    border-top-color: #8db7ce;
    border-radius: 50%;
    animation: logs-spin 800ms linear infinite;
}

@keyframes logs-spin {
    to {
        transform: rotate(360deg);
    }
}

.logs-list {
    display: flex;
    flex-direction: column;
}

.log-entry {
    display: grid;
    min-width: 0;
    gap: 12px;
    padding: 13px 15px;
    border-bottom: 1px solid #232925;
    grid-template-columns: 3px minmax(0, 1fr);
}

.log-entry:last-child {
    border-bottom: 0;
}

.log-severity-indicator {
    width: 3px;
    height: 100%;
    min-height: 32px;
    border-radius: 2px;
    background: #77817b;
}

.log-entry--debug .log-severity-indicator {
    background: #8e9290;
}

.log-entry--info .log-severity-indicator {
    background: #82afc8;
}

.log-entry--warning .log-severity-indicator {
    background: #d2a269;
}

.log-entry--error .log-severity-indicator {
    background: #d77e79;
}

.log-entry-content {
    min-width: 0;
}

.log-entry-content header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    color: #7e8882;
    font-size: 12px;
}

.log-severity {
    color: #b7bcb8;
    font-weight: 750;
    text-transform: uppercase;
}

.log-source {
    overflow: hidden;
    color: #91b4c7;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.log-entry-content time {
    flex: 0 0 auto;
    margin-left: auto;
}

.log-entry-content > p {
    margin: 6px 0 0;
    color: #d6d3cb;
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.log-entry-content pre {
    margin: 9px 0 0;
    padding: 10px 11px;
    overflow-x: auto;
    border-radius: 5px;
    color: #aeb5b0;
    background: #111613;
    font: 12.5px/1.55 "Cascadia Mono", "Consolas", monospace;
    white-space: pre-wrap;
}

.logs-footer {
    display: flex;
    height: 74px;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: 15px 26px;
}

.logs-footer-group {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 9px;
}

.logs-button {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 15px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}

.logs-button--secondary {
    color: #dedad1;
    background: #1a201d;
}

.logs-button--primary {
    color: #10191e;
    background: #91b8cf;
}

.logs-button--clear:not(:disabled) {
    color: #e4b0ac;
    background: #241817;
}

.logs-button--refresh.is-loading svg {
    animation: logs-spin 800ms linear infinite;
}

.logs-button:hover:not(:disabled) {
    filter: brightness(1.08);
}

.logs-button:disabled {
    color: #666c68;
    background: #171a18;
    cursor: not-allowed;
}

@media (max-width: 1050px) {
    .titlebar-action span {
        display: none;
    }

    .titlebar-action {
        width: 38px;
        padding: 0;
    }

    .logs-toolbar {
        grid-template-columns: minmax(220px, 1fr) minmax(140px, 180px) minmax(140px, 180px) auto;
    }
}

@media (max-width: 760px) {
    .app-titlebar {
        padding-left: 10px;
    }

    .titlebar-version {
        display: none;
    }

    .logs-popover {
        width: calc(100vw - 20px);
        height: calc(100vh - 20px);
    }

    .logs-toolbar {
        grid-template-columns: 1fr 1fr;
    }

    .logs-search {
        grid-column: 1 / -1;
    }

    .logs-clear-filters {
        justify-self: start;
    }

    .logs-viewport {
        min-height: 140px;
    }

    .logs-footer {
        height: auto;
        align-items: stretch;
        flex-direction: column;
    }

    .logs-footer-group {
        justify-content: flex-end;
    }

    .logs-footer-group:first-child {
        justify-content: flex-start;
    }
}

@media (prefers-reduced-motion: reduce) {
    .logs-loading-spinner {
        animation-duration: 1.6s;
    }
}
</style>
