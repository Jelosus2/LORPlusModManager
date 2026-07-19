<template>
    <div class="app-shell">
        <aside class="sidebar">
            <nav class="main-navigation" aria-label="Main navigation">
                <button class="navigation-item navigation-item--active" type="button" aria-current="page">
                    Mods
                </button>
                <button class="navigation-item" type="button">
                    Settings
                </button>
            </nav>
        </aside>

        <main class="main-content">
            <header class="content-header">
                <div>
                    <p class="content-label">Library</p>
                    <h1>Mods</h1>
                </div>

                <button class="add-mod-button" type="button">
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
        </main>
    </div>
</template>

<style scoped>
.app-shell {
    display: grid;
    min-height: 100vh;
    grid-template-columns: clamp(190px, 18vw, 230px) minmax(0, 1fr);
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
}

@media (prefers-reduced-motion: reduce) {
    .navigation-item,
    .add-mod-button {
        transition: none;
    }
}
</style>
