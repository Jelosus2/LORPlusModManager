<script setup lang="ts">
import type { SelectedModSource } from "../../shared/mod.ts";

import { computed } from "vue";

const props = defineProps<{
    sources: SelectedModSource[];
    message: string;
    failed: boolean;
    busy: boolean;
    complete: boolean;
}>();

const passwords = defineModel<Record<string, string>>("passwords", { required: true });
const deleteOriginals = defineModel<boolean>("deleteOriginals", { required: true });

defineEmits<{
    back: [];
    close: [];
    extract: [];
}>();

const zipSources = computed(() => props.sources.filter((source) => source.kind === "zip"));
const assetBundleSources = computed(() => props.sources.filter((source) => source.kind === "asset-bundle"));

function formatFileSize(bytes: number) {
    if (bytes < 1024)
        return `${bytes} B`;

    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1)
    {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
</script>

<template>
    <section
        id="zip-extraction-popover"
        class="zip-extraction-popover"
        popover="manual"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zip-extraction-title"
        aria-describedby="zip-extraction-description"
    >
        <header class="modal-header">
            <div>
                <p class="modal-label">Import · ZIP setup</p>
                <h2 id="zip-extraction-title">Prepare ZIP files</h2>
            </div>

            <button
                class="close-button"
                type="button"
                aria-label="Close ZIP preparation"
                @click="$emit('close')"
            >
                <span aria-hidden="true"></span>
            </button>
        </header>

        <p id="zip-extraction-description" class="modal-description">
            Add a password only when an archive is encrypted. Recognized
            character assets will be found automatically.
        </p>

        <div v-if="zipSources.length > 0" class="source-list">
            <article
                v-for="source in zipSources"
                :key="source.id"
                class="source-card"
            >
                <div class="source-heading">
                    <span class="zip-badge">ZIP</span>

                    <span class="source-details">
                        <strong :title="source.name">{{ source.name }}</strong>
                        <small>{{ formatFileSize(source.size) }}</small>
                    </span>
                </div>

                <label class="password-field">
                    <span>
                        Password
                        <small>Optional</small>
                    </span>

                    <input
                        v-model="passwords[source.id]"
                        type="password"
                        autocomplete="off"
                        placeholder="Archive password"
                    />
                </label>
            </article>
        </div>

        <div v-else class="no-zip-notice">
            No ZIP archives were selected.
        </div>

        <div
            v-if="assetBundleSources.length > 0"
            class="deferred-sources"
        >
            <p>AssetBundles</p>

            <div
                v-for="source in assetBundleSources"
                :key="source.id"
                class="deferred-source"
            >
                <span :title="source.name">{{ source.name }}</span>
                <small>Support will be added later</small>
            </div>
        </div>

        <label class="delete-source-option">
            <input v-model="deleteOriginals" type="checkbox" />

            <span>
                <strong>Delete original ZIP files after importing</strong>
                <small>
                    Files are deleted only after all recognized assets are
                    extracted successfully.
                </small>
            </span>
        </label>

        <p
            v-if="message"
            class="modal-feedback"
            :class="{ 'modal-feedback--error': failed }"
            role="status"
            aria-live="polite"
        >
            {{ message }}
        </p>

        <footer class="modal-actions">
            <button
                class="secondary-button"
                type="button"
                :disabled="props.busy"
                @click="$emit('back')"
            >
                Back
            </button>

            <button
                class="primary-button"
                type="button"
                :disabled="zipSources.length === 0 || props.busy || props.complete"
                @click="$emit('extract')"
            >
                {{
                    props.busy
                        ? "Extracting..."
                        : props.complete
                            ? "Imported"
                            : "Extract mods"
                }}
            </button>
        </footer>
    </section>
</template>

<style scoped>
.zip-extraction-popover {
    width: min(620px, calc(100vw - 32px));
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

.zip-extraction-popover:popover-open {
    animation: modal-in 160ms ease-out;
}

.zip-extraction-popover::backdrop {
    background: rgb(0 0 0 / 72%);
}

.modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 26px 28px 0;
}

.modal-label {
    margin: 0 0 4px;
    color: #9bc2d9;
    font-size: 13px;
    font-weight: 650;
}

.modal-header h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.015em;
}

.close-button {
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

.close-button:hover {
    color: #f2eee5;
    background: #181c1a;
}

.close-button span {
    position: relative;
    width: 16px;
    height: 16px;
}

.close-button span::before,
.close-button span::after {
    position: absolute;
    top: 7px;
    left: 1px;
    width: 14px;
    height: 2px;
    border-radius: 1px;
    background: currentColor;
    content: "";
}

.close-button span::before {
    transform: rotate(45deg);
}

.close-button span::after {
    transform: rotate(-45deg);
}

.modal-description {
    margin: 16px 28px 22px;
    color: #aeb1ab;
    font-size: 15px;
    line-height: 1.55;
}

.source-list {
    display: grid;
    gap: 9px;
    padding: 0 20px;
}

.source-card {
    display: grid;
    gap: 16px;
    padding: 16px;
    border-radius: 9px;
    background: #121513;
}

.source-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
}

.zip-badge {
    flex: 0 0 auto;
    padding: 6px 8px;
    border-radius: 5px;
    color: #b7d2e1;
    background: #1a2429;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.04em;
}

.source-details {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
}

.source-details strong {
    overflow: hidden;
    font-size: 14px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.source-details small,
.password-field small {
    color: #858a84;
    font-size: 12px;
}

.password-field {
    display: grid;
    gap: 7px;
}

.password-field > span {
    display: flex;
    align-items: baseline;
    gap: 7px;
    color: #c9c5bc;
    font-size: 13px;
    font-weight: 600;
}

.password-field input {
    width: 100%;
    height: 42px;
    box-sizing: border-box;
    padding: 0 12px;
    border: 1px solid #343936;
    border-radius: 7px;
    outline: none;
    color: #f2eee5;
    background: #090b0a;
    font: inherit;
    font-size: 14px;
}

.password-field input:focus {
    border-color: #86aec7;
}

.password-field input::placeholder {
    color: #686d68;
}

.deferred-sources {
    display: grid;
    gap: 7px;
    margin: 18px 28px 0;
}

.deferred-sources > p {
    margin: 0;
    color: #858a84;
    font-size: 12px;
    font-weight: 600;
}

.deferred-source {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 12px;
    border-radius: 7px;
    color: #929791;
    background: #101311;
    font-size: 13px;
}

.deferred-source span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.deferred-source small {
    flex: 0 0 auto;
    color: #6f746f;
}

.no-zip-notice {
    margin: 0 28px;
    padding: 16px;
    border-radius: 8px;
    color: #aaa69e;
    background: #121513;
    font-size: 14px;
}

.delete-source-option {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    margin: 20px 28px 0;
    cursor: pointer;
}

.delete-source-option input {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    margin: 2px 0 0;
    accent-color: #86aec7;
}

.delete-source-option > span {
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.delete-source-option strong {
    color: #d8d4cb;
    font-size: 13px;
    font-weight: 650;
}

.delete-source-option small {
    color: #858a84;
    font-size: 12px;
    line-height: 1.45;
}

.modal-feedback {
    margin: 16px 28px 0;
    color: #aeb4ae;
    font-size: 13px;
    line-height: 1.5;
}

.modal-feedback--error {
    color: #efa3a3;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    padding: 24px 28px 26px;
}

.primary-button,
.secondary-button {
    min-height: 42px;
    padding: 0 17px;
    border: 0;
    border-radius: 7px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
}

.primary-button {
    color: #172027;
    background: #86aec7;
}

.primary-button:hover {
    background: #9bbfd5;
}

.primary-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.secondary-button {
    color: #d8d4cb;
    background: #1a1e1b;
}

.secondary-button:hover {
    background: #222723;
}

@keyframes modal-in {
    from {
        opacity: 0;
        transform: translateY(8px) scale(0.985);
    }

    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

@media (max-width: 480px) {
    .modal-header {
        padding: 22px 22px 0;
    }

    .modal-description,
    .deferred-sources,
    .no-zip-notice,
    .delete-source-option,
    .modal-feedback {
        margin-right: 22px;
        margin-left: 22px;
    }

    .source-list {
        padding: 0 14px;
    }

    .deferred-source {
        align-items: flex-start;
        flex-direction: column;
        gap: 3px;
    }

    .modal-actions {
        padding: 22px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .zip-extraction-popover:popover-open {
        animation: none;
    }
}
</style>
