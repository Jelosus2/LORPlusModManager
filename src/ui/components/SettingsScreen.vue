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
                                <span class="status-chip status-chip--success">Valid installation</span>
                            </div>
                            <p>The folder containing the Last Origin R+ executable.</p>
                        </div>

                        <div class="path-field" aria-label="Selected game location">
                            <span>Your selected game folder will appear here</span>
                        </div>

                        <div class="setting-actions">
                            <button class="settings-button settings-button--secondary" type="button">
                                Auto-detect
                            </button>
                            <button class="settings-button settings-button--secondary" type="button">
                                Choose folder
                            </button>
                            <button class="settings-button settings-button--quiet" type="button">
                                Open folder
                            </button>
                        </div>
                    </div>

                    <div class="setting-row">
                        <div class="setting-copy">
                            <div class="setting-title-line">
                                <h3>LOPlugin+</h3>
                                <span class="status-chip status-chip--success">Installed</span>
                            </div>
                            <p>
                                Installed version <span class="setting-value">1.3.8.1</span>
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
}
</style>
