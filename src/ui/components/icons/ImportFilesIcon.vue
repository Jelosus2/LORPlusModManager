<template>
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="back-file" d="M3.5 2.5h8l3.5 3.5v8.5H3.5z" />
        <path class="file" d="M6 5h8l4 4v5.75H6z" />
        <path class="fold" d="M14 5v4h4" />
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

.back-file {
    opacity: 0.58;
}

.back-file,
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
