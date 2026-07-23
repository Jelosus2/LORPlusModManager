<template>
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="file" d="M5 3.5h9l4 4v7.25H5z" />
        <path class="fold" d="M14 3.5v4h4" />
        <circle class="badge" cx="17.5" cy="17.5" r="5.5" />
        <path class="plus" d="M17.5 14.75v5.5M14.75 17.5h5.5" />
    </svg>
</template>

<style scoped>
svg {
    display: block;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.file,
.fold {
    stroke-width: 1.6;
}

.badge {
    fill: currentColor;
    stroke: none;
}

.plus {
    stroke: #1a2429;
    stroke-width: 1.5;
}
</style>
