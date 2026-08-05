<script setup lang="ts">
import type { PluginConfiguration, PluginConfigurationEntry, PluginConfigurationUpdate } from "../../shared/plugin";

import RefreshIcon from "./icons/RefreshIcon.vue";
import PluginIcon from "./icons/PluginIcon.vue";

import { ApplicationLogSource } from "../../shared/application";
import { RendererLogger } from "@/utils/RendererLogger";
import { ErrorUtils } from "@/utils/ErrorUtils.ts";
import { ref, computed, onMounted } from "vue";

const configuration = ref<PluginConfiguration | null>(null);
const originalValues = ref<Record<string, string>>({});
const draftValues = ref<Record<string, string>>({});
const errorMessage = ref("");
const saveErrorMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);

const settingCount = computed(() =>
    configuration.value?.sections.reduce((total, section) => total + section.entries.length, 0) ?? 0
);

const dirtySettingCount = computed(() =>
    Object.entries(draftValues.value).reduce((total, [identity, value]) => total + (originalValues.value[identity] !== value ? 1 : 0), 0)
);

const hasUnsavedChanges = computed(() => dirtySettingCount.value > 0);

const hasNonDefaultValues = computed(() => {
    const current = configuration.value;
    return current?.sections.some((section) => section.entries.some((entry) => isEntryDifferentFromDefault(section.name, entry))) ?? false;
});

async function loadConfiguration() {
    if (isLoading.value || isSaving.value || hasUnsavedChanges.value)
        return;

    isLoading.value = true;
    errorMessage.value = "";
    saveErrorMessage.value = "";

    try
    {
        const loaded = await window.app.getLOPluginConfiguration();

        initializeDraftValues(loaded);
        configuration.value = loaded;
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.plugin, "Could not load the LOPlugin+ configuration.", error);
        errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The LOPlugin+ configuration could not be loaded.");
    }
    finally
    {
        isLoading.value = false;
    }
}

async function saveConfiguration() {
    const current = configuration.value;

    if (isSaving.value || !current?.exists || !current.revision || !hasUnsavedChanges.value)
        return;

    const updates: PluginConfigurationUpdate[] = [];

    for (const section of current.sections)
    {
        for (const entry of section.entries)
        {
            if (!isEntryDirty(section.name, entry.key))
                continue;

            updates.push({
                section: section.name,
                key: entry.key,
                value: getDraftValue(section.name, entry.key)
            });
        }
    }

    if (updates.length === 0)
        return;

    isSaving.value = true;
    saveErrorMessage.value = "";

    try
    {
        const saved = await window.app.saveLOPluginConfiguration({ revision: current.revision, updates });

        initializeDraftValues(saved);
        configuration.value = saved;

        RendererLogger.info(ApplicationLogSource.plugin, "Saved the LOPlugin+ configuration.", { settingsChanged: updates.length });
    }
    catch (error)
    {
        RendererLogger.error(ApplicationLogSource.plugin, "Could not save the LOPlugin+ configuration.", error);
        saveErrorMessage.value = ErrorUtils.getUserErrorMessage(error, "The LOPlugin+ configuration could not be saved.");
    }
    finally
    {
        isSaving.value = false;
    }
}

function areConfigurationValuesEquivalent(entry: PluginConfigurationEntry, left: string, right: string): boolean {
    const trimmedLeft = left.trim();
    const trimmedRight = right.trim();

    if (entry.valueKind === "boolean" || entry.acceptableValues.length > 0)
        return trimmedLeft.toLocaleLowerCase("en-US") === trimmedRight.toLocaleLowerCase("en-US");

    if (entry.valueKind === "number")
    {
        if (!trimmedLeft || !trimmedRight)
            return trimmedLeft === trimmedRight;

        const leftNumber = Number(trimmedLeft);
        const rightNumber = Number(trimmedRight);

        return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
    }

    return left === right;
}

function initializeDraftValues(value: PluginConfiguration) {
    const values: Record<string, string> = {};

    for (const section of value.sections)
    {
        for (const entry of section.entries)
        {
            values[getSettingIdentity(section.name, entry.key)] = entry.value;
        }
    }

    originalValues.value = { ...values };
    draftValues.value = { ...values };
}

function getSettingIdentity(section: string, key: string): string {
    return JSON.stringify([
        section.toLocaleLowerCase("en-US"),
        key.toLocaleLowerCase("en-US")
    ]);
}

function getDraftValue(section: string, key: string): string {
    return draftValues.value[getSettingIdentity(section, key)] ?? "";
}

function setDraftValue(section: string, key: string, value: string) {
    draftValues.value[getSettingIdentity(section, key)] = value;
    saveErrorMessage.value = "";
}

function updateDraftFromEvent(section: string, key: string, event: Event) {
    const target = event.target;

    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement))
        return;

    setDraftValue(section, key, target.value);
}

function updateBooleanDraft(section: string, key: string, event: Event) {
    const target = event.target;

    if (!(target instanceof HTMLInputElement))
        return;

    setDraftValue(section, key, target.checked ? "true" : "false");
}

function isDraftBooleanEnabled(section: string, key: string): boolean {
    return /^true$/i.test(getDraftValue(section, key).trim());
}

function isDraftValueAccepted(section: string, entry: PluginConfigurationEntry): boolean {
    const value = getDraftValue(section, entry.key).trim();

    return entry.acceptableValues.some((candidate) => candidate.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US"));
}

function isEntryDirty(section: string, key: string): boolean {
    const identity = getSettingIdentity(section, key);

    return draftValues.value[identity] !== originalValues.value[identity];
}

function isEntryDifferentFromDefault(section: string, entry: PluginConfigurationEntry): boolean {
    return !areConfigurationValuesEquivalent(entry, getDraftValue(section, entry.key), entry.defaultValue);
}

function useEntryDefault(section: string, entry: PluginConfigurationEntry) {
    if (isLoading.value || isSaving.value)
        return;

    setDraftValue(section, entry.key, entry.defaultValue);
}

function useAllDefaults() {
    const current = configuration.value;
    if (!current || isLoading.value || isSaving.value)
        return;

    for (const section of current.sections)
    {
        for (const entry of section.entries)
            setDraftValue(section.name, entry.key, entry.defaultValue);
    }
}

function undoEntryChange(section: string, key: string) {
    const identity = getSettingIdentity(section, key);

    draftValues.value[identity] = originalValues.value[identity] ?? "";
    saveErrorMessage.value = "";
}

function discardChanges() {
    if (isSaving.value)
        return;

    draftValues.value = { ...originalValues.value };
    saveErrorMessage.value = "";
}

function formatConfigurationValue(value: string): string {
    return value.trim() || "Empty";
}

onMounted(loadConfiguration);
</script>

<template>
    <section class="plugin-view" aria-labelledby="plugin-title">
        <header class="plugin-header">
            <div>
                <p class="content-label">Configuration</p>
                <h1 id="plugin-title">Plugin</h1>
            </div>

            <button
                v-if="configuration?.exists"
                class="plugin-action-button"
                :class="{ 'is-loading': isLoading }"
                type="button"
                :disabled="isLoading || isSaving || hasUnsavedChanges"
                :title="hasUnsavedChanges ? 'Save or discard your changes before reloading.' : undefined"
                @click="loadConfiguration"
            >
                <RefreshIcon />
                <span>{{ isLoading ? "Reloading…" : "Reload file" }}</span>
            </button>
        </header>

        <div
            v-if="isLoading && !configuration"
            class="plugin-message"
            aria-live="polite"
        >
            <span class="plugin-message-spinner" aria-hidden="true"></span>
            <strong>Loading plugin configuration</strong>
            <p>Reading the configuration generated by LOPlugin+.</p>
        </div>

        <div
            v-else-if="errorMessage"
            class="plugin-message plugin-message--error"
            role="alert"
        >
            <PluginIcon aria-hidden="true" />
            <strong>Configuration could not be loaded</strong>
            <p>{{ errorMessage }}</p>
            <button type="button" :disabled="isLoading" @click="loadConfiguration">
                Try again
            </button>
        </div>

        <div
            v-else-if="configuration && !configuration.exists"
            class="plugin-message"
        >
            <PluginIcon aria-hidden="true" />
            <strong>Plugin configuration not generated yet</strong>
            <p>
                Start Last Origin R+ once with LOPlugin+ installed. The plugin
                will create its configuration file when the game launches.
            </p>
            <button type="button" :disabled="isLoading" @click="loadConfiguration">
                Check again
            </button>
        </div>

        <div
            v-else-if="configuration"
            class="plugin-editor"
            :class="{ 'plugin-editor--busy': isLoading || isSaving }"
        >
            <div class="plugin-content">
                <div class="configuration-summary">
                    <div>
                        <div>
                            <strong>LOPlugin+ configuration</strong>
                        <p>
                            {{ settingCount }}
                            {{ settingCount === 1 ? "setting" : "settings" }}
                            across {{ configuration.sections.length }}
                            {{ configuration.sections.length === 1 ? "section" : "sections" }}
                        </p>
                    </div>
                </div>

                <code :title="configuration.filePath">
                    {{ configuration.filePath }}
                </code>
            </div>

            <div class="plugin-sections">
                <section
                    v-for="section in configuration.sections"
                    :key="section.name"
                    class="plugin-section"
                    :aria-labelledby="`plugin-section-${section.id}`"
                >
                    <header class="plugin-section-heading">
                        <div>
                            <h2 :id="`plugin-section-${section.id}`">
                                {{ section.name }}
                            </h2>
                            <p>
                                {{ section.entries.length }}
                                {{ section.entries.length === 1 ? "setting" : "settings" }}
                            </p>
                        </div>
                    </header>

                    <div class="plugin-setting-list">
                        <article
                            v-for="entry in section.entries"
                            :key="entry.key"
                            class="plugin-setting"
                            :class="{
                                'plugin-setting--changed': isEntryDirty(section.name, entry.key)
                            }"
                        >
                            <div class="plugin-setting-copy">
                                <div class="plugin-setting-title">
                                    <h3>{{ entry.key }}</h3>
                                    <span
                                        v-if="isEntryDirty(section.name, entry.key)"
                                        class="changed-label"
                                    >
                                        Changed
                                    </span>
                                </div>
                                <p>
                                    {{ entry.description || "No description was provided by LOPlugin+." }}
                                </p>

                                <div class="plugin-setting-metadata">
                                    <span>
                                        <strong class="metadata-label">Type</strong>
                                        <span class="metadata-value">{{ entry.settingType }}</span>
                                    </span>
                                    <span>
                                        <strong class="metadata-label">Default</strong>
                                        <span class="metadata-value">
                                            {{ formatConfigurationValue(entry.defaultValue) }}
                                        </span>
                                    </span>
                                </div>
                            </div>

                            <div class="plugin-setting-control">
                                <label
                                    v-if="entry.valueKind === 'boolean'"
                                    class="boolean-control"
                                >
                                    <input
                                        type="checkbox"
                                        :checked="isDraftBooleanEnabled(section.name, entry.key)"
                                        :disabled="isLoading || isSaving"
                                        @change="updateBooleanDraft(section.name, entry.key, $event)"
                                    />
                                    <span class="boolean-switch" aria-hidden="true"></span>
                                    <span>
                                        {{
                                            isDraftBooleanEnabled(section.name, entry.key)
                                                ? "Enabled"
                                                : "Disabled"
                                        }}
                                    </span>
                                </label>

                                <div
                                    v-else-if="entry.acceptableValues.length > 0"
                                    class="select-control"
                                >
                                    <select
                                        :aria-label="entry.key"
                                        :value="getDraftValue(section.name, entry.key)"
                                        :disabled="isLoading || isSaving"
                                        @change="updateDraftFromEvent(section.name, entry.key, $event)"
                                    >
                                        <option
                                            v-if="!isDraftValueAccepted(section.name, entry)"
                                            :value="getDraftValue(section.name, entry.key)"
                                        >
                                            {{ getDraftValue(section.name, entry.key) }} (current)
                                        </option>
                                        <option
                                            v-for="option in entry.acceptableValues"
                                            :key="option"
                                            :value="option"
                                        >
                                            {{ option }}
                                        </option>
                                    </select>
                                </div>

                                <input
                                    v-else
                                    class="text-control"
                                    :type="entry.valueKind === 'number' ? 'number' : 'text'"
                                    :step="entry.valueKind === 'number' ? 'any' : undefined"
                                    :aria-label="entry.key"
                                    :value="getDraftValue(section.name, entry.key)"
                                    :disabled="isLoading || isSaving"
                                    spellcheck="false"
                                    @input="updateDraftFromEvent(section.name, entry.key, $event)"
                                />

                                <div
                                    v-if="
                                        isEntryDifferentFromDefault(section.name, entry) ||
                                        isEntryDirty(section.name, entry.key)
                                    "
                                    class="plugin-setting-actions"
                                >
                                    <button
                                        v-if="isEntryDifferentFromDefault(section.name, entry)"
                                        class="default-setting-button"
                                        type="button"
                                        :disabled="isLoading || isSaving"
                                        @click="useEntryDefault(section.name, entry)"
                                    >
                                        Use default
                                    </button>
                                    <button
                                        v-if="isEntryDirty(section.name, entry.key)"
                                        class="undo-setting-button"
                                        type="button"
                                        :disabled="isLoading || isSaving"
                                        @click="undoEntryChange(section.name, entry.key)"
                                    >
                                        Undo
                                    </button>
                                </div>
                            </div>
                        </article>
                    </div>
                </section>
            </div>
            </div>

            <p
                v-if="saveErrorMessage"
                class="configuration-save-message configuration-save-message--error"
                role="alert"
            >
                {{ saveErrorMessage }}
            </p>

            <footer class="configuration-actions">
                <div class="configuration-change-state" aria-live="polite">
                    <strong v-if="hasUnsavedChanges">
                        {{ dirtySettingCount }}
                        {{ dirtySettingCount === 1 ? "unsaved change" : "unsaved changes" }}
                    </strong>
                    <strong v-else>All changes saved</strong>
                    <span>
                        {{
                            hasUnsavedChanges
                                ? "Save to apply these settings the next time the plugin reads its configuration."
                                : "The editor matches the configuration file on disk."
                        }}
                    </span>
                </div>

                <div class="configuration-action-buttons">
                    <button
                        class="defaults-button"
                        type="button"
                        :disabled="!hasNonDefaultValues || isLoading || isSaving"
                        @click="useAllDefaults"
                    >
                        Reset all to defaults
                    </button>
                    <button
                        class="discard-button"
                        type="button"
                        :disabled="!hasUnsavedChanges || isLoading || isSaving"
                        @click="discardChanges"
                    >
                        Discard changes
                    </button>
                    <button
                        class="save-button"
                        type="button"
                        :disabled="!hasUnsavedChanges || isLoading || isSaving"
                        @click="saveConfiguration"
                    >
                        {{ isSaving ? "Saving…" : "Save changes" }}
                    </button>
                </div>
            </footer>
        </div>
    </section>
</template>

<style scoped>
.plugin-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
}

.plugin-header {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 28px;
    border-bottom: 1px solid #292e2b;
}

.content-label,
h1,
h2,
h3,
p {
    margin: 0;
}

.content-label {
    margin-bottom: 6px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

h1 {
    color: #f2eee5;
    font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
    font-size: clamp(34px, 4vw, 44px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
}

.plugin-action-button,
.plugin-message button {
    display: inline-flex;
    min-height: 42px;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 0 16px;
    border: 0;
    border-radius: 7px;
    color: #e8e4dc;
    background: #171b18;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.plugin-action-button:hover:not(:disabled),
.plugin-message button:hover:not(:disabled) {
    color: #f2eee5;
    background: #202521;
}

.plugin-action-button:disabled,
.plugin-message button:disabled {
    color: #676d68;
    cursor: not-allowed;
}

.plugin-action-button:focus-visible,
.plugin-message button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.plugin-action-button svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.plugin-action-button.is-loading svg {
    animation: plugin-spin 850ms linear infinite;
}

.plugin-message {
    display: flex;
    width: min(520px, 100%);
    min-height: 0;
    flex: 1;
    align-self: center;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    padding: 40px 20px;
    color: #929993;
    text-align: center;
}

.plugin-message > svg {
    width: 34px;
    height: 34px;
    margin-bottom: 4px;
    fill: none;
    stroke: #74817a;
    stroke-width: 1.55;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.plugin-message strong {
    color: #e7e3da;
    font-size: 17px;
    font-weight: 700;
}

.plugin-message p {
    max-width: 480px;
    font-size: 13px;
    line-height: 1.6;
}

.plugin-message button {
    margin-top: 8px;
    color: #dcecf5;
    background: #182329;
}

.plugin-message--error > svg {
    stroke: #df8585;
}

.plugin-message--error strong,
.plugin-message--error p {
    color: #e7a0a0;
}

.plugin-message-spinner {
    width: 28px;
    height: 28px;
    margin-bottom: 6px;
    border: 3px solid #26302b;
    border-top-color: #94bdd3;
    border-radius: 50%;
    animation: plugin-spin 850ms linear infinite;
}

.plugin-editor {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
}

.plugin-content {
    min-height: 0;
    flex: 1;
    padding: 24px 8px 28px 0;
    overflow-y: auto;
    transition: opacity 120ms ease;
}

.plugin-editor--busy .plugin-content {
    opacity: 0.58;
    pointer-events: none;
}

.configuration-summary {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 15px 17px;
    border-radius: 8px;
    background: #101411;
}

.configuration-summary > div {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
}

.configuration-summary strong {
    color: #e8e4dc;
    font-size: 14px;
    font-weight: 650;
}

.configuration-summary p {
    margin-top: 3px;
    color: #879088;
    font-size: 12px;
}

.configuration-summary > code {
    min-width: 0;
    max-width: min(54%, 720px);
    overflow: hidden;
    color: #94bdd3;
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.plugin-sections {
    display: flex;
    flex-direction: column;
}

.plugin-section {
    padding: 28px 0;
    border-bottom: 1px solid #252a27;
}

.plugin-section:last-child {
    border-bottom: 0;
}

.plugin-section-heading {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
}

.plugin-section-heading h2 {
    color: #f2eee5;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.3;
}

.plugin-section-heading p {
    color: #858d87;
    font-size: 12px;
}

.plugin-setting-list {
    overflow: hidden;
    border: 1px solid #292f2b;
    border-radius: 8px;
    background: #0e120f;
}

.plugin-setting {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 340px);
    min-width: 0;
    min-height: 108px;
    align-items: center;
    gap: 32px;
    padding: 17px 18px;
    border-bottom: 1px solid #242a26;
    background: #101411;
    transition: background-color 120ms ease;
}

.plugin-setting:last-child {
    border-bottom: 0;
}

.plugin-setting--changed {
    background: #11191a;
}

.plugin-setting--changed::before {
    position: absolute;
    inset: 12px auto 12px 0;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: #94bdd3;
    content: "";
}

.plugin-setting-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    align-self: stretch;
    flex-direction: column;
}

.plugin-setting h3 {
    color: #e8e4dc;
    font-size: 14px;
    font-weight: 650;
    line-height: 1.4;
}

.plugin-setting-title {
    display: flex;
    min-width: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
}

.changed-label {
    padding: 3px 6px;
    border-radius: 4px;
    color: #b9d9e9;
    background: #17262d;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

.plugin-setting-copy > p {
    margin-top: 4px;
    color: #8f9690;
    font-size: 12px;
    line-height: 1.5;
}

.plugin-setting-metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
    padding-top: 10px;
    color: #c5cbc6;
    font-size: 12px;
}

.plugin-setting-metadata > span {
    display: inline-flex;
    min-height: 25px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    border-radius: 5px;
    background: #171c19;
}

.metadata-label,
.metadata-value {
    line-height: 1;
}

.plugin-setting-metadata .metadata-label {
    color: #8f9891;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.035em;
    text-transform: uppercase;
}

.metadata-value {
    color: #d7dcd8;
    font-size: 12px;
}

.plugin-setting-control {
    display: flex;
    min-width: 0;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
}

.text-control,
.select-control,
.select-control select {
    width: 100%;
    min-width: 0;
}

.text-control,
.select-control select {
    height: 40px;
    border: 1px solid #343b36;
    border-radius: 6px;
    color: #e8e4dc;
    background-color: #0b0f0c;
    font: inherit;
    font-size: 13px;
}

.text-control {
    padding: 0 12px;
}

.select-control {
    position: relative;
}

.select-control::after {
    position: absolute;
    top: 50%;
    right: 13px;
    width: 7px;
    height: 7px;
    border-right: 2px solid #9ba29d;
    border-bottom: 2px solid #9ba29d;
    pointer-events: none;
    content: "";
    transform: translateY(-68%) rotate(45deg);
}

.select-control select {
    padding: 0 38px 0 12px;
    appearance: none;
}

.text-control:hover:not(:disabled),
.select-control select:hover:not(:disabled) {
    border-color: #48514b;
}

.text-control:focus,
.select-control select:focus {
    border-color: #94bdd3;
    outline: 0;
    box-shadow: 0 0 0 2px rgb(148 189 211 / 11%);
}

.text-control:disabled,
.select-control select:disabled {
    color: #666d68;
    cursor: not-allowed;
}

.boolean-control {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #c3c8c4;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.boolean-control input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}

.boolean-switch {
    position: relative;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
    border: 1px solid #3c443f;
    border-radius: 999px;
    background: #171c19;
    transition: border-color 120ms ease, background-color 120ms ease;
}

.boolean-switch::after {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #8b938d;
    content: "";
    transition: transform 120ms ease, background-color 120ms ease;
}

.boolean-control input:checked + .boolean-switch {
    border-color: #476878;
    background: #172a33;
}

.boolean-control input:checked + .boolean-switch::after {
    background: #a9cee0;
    transform: translateX(16px);
}

.boolean-control input:focus-visible + .boolean-switch {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.boolean-control:has(input:disabled) {
    color: #666d68;
    cursor: not-allowed;
}

.plugin-setting-actions {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
}

.default-setting-button,
.undo-setting-button {
    min-height: 34px;
    flex: 0 0 auto;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    color: #aeb5b0;
    background: transparent;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
}

.default-setting-button {
    color: #a9cbdc;
}

.default-setting-button:hover:not(:disabled),
.undo-setting-button:hover:not(:disabled) {
    color: #f2eee5;
    background: #202521;
}

.configuration-save-message {
    flex: 0 0 auto;
    margin: 0 8px 10px 0;
    padding: 10px 13px;
    border-radius: 6px;
    font-size: 13px;
}

.configuration-save-message--error {
    color: #efa1a1;
    background: #2b1717;
}

.configuration-actions {
    display: flex;
    min-width: 0;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 8px 14px 0;
    border-top: 1px solid #292e2b;
    background: #080c09;
}

.configuration-change-state {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.configuration-change-state strong {
    color: #e8e4dc;
    font-size: 13px;
    font-weight: 650;
}

.configuration-change-state span {
    color: #858d87;
    font-size: 11px;
}

.configuration-action-buttons {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
}

.configuration-action-buttons button {
    min-height: 42px;
    padding: 0 16px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}

.discard-button {
    color: #e8e4dc;
    background: #171b18;
}

.defaults-button {
    color: #c7dce7;
    background: #172126;
}

.save-button {
    color: #0b1720;
    background: #94bdd3;
}

.discard-button:hover:not(:disabled) {
    background: #202521;
}

.defaults-button:hover:not(:disabled) {
    color: #e6f1f6;
    background: #1d2b32;
}

.save-button:hover:not(:disabled) {
    background: #a6c9dc;
}

.configuration-action-buttons button:focus-visible,
.default-setting-button:focus-visible,
.undo-setting-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.configuration-action-buttons button:disabled,
.default-setting-button:disabled,
.undo-setting-button:disabled {
    color: #626863;
    background: #121613;
    cursor: not-allowed;
}

@keyframes plugin-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 760px) {
    .plugin-header,
    .configuration-summary,
    .configuration-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .plugin-action-button {
        align-self: flex-start;
    }

    .configuration-summary > code {
        max-width: 100%;
    }

    .plugin-setting {
        grid-template-columns: minmax(0, 1fr);
        gap: 14px;
    }

    .configuration-action-buttons,
    .configuration-action-buttons button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .plugin-action-button.is-loading svg,
    .plugin-message-spinner {
        animation: none;
    }
}
</style>
