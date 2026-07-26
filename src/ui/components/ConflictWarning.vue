<script setup lang="ts">
import type { CSSProperties } from "vue";

import WarningIcon from "./icons/WarningIcon.vue";

import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = defineProps<{
    message: string;
}>();

const tooltipId = `conflict-tooltip-${useId()}`;
const trigger = ref<HTMLElement | null>(null);
const tooltip = ref<HTMLElement | null>(null);
const visible = ref(false);
const tooltipStyle = ref<CSSProperties>({});

async function showTooltip() {
    visible.value = true;
    await nextTick();
    positionTooltip();
}

function hideTooltip() {
    visible.value = false;
}

function positionTooltip() {
    if (!trigger.value || !tooltip.value)
        return;

    const viewportPadding = 12;
    const gap = 10;
    const triggerRect = trigger.value.getBoundingClientRect();
    const tooltipRect = tooltip.value.getBoundingClientRect();

    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));

    let top = triggerRect.top - tooltipRect.height - gap;
    if (top < viewportPadding)
        top = triggerRect.bottom + gap;

    top = Math.min(top, window.innerHeight - tooltipRect.height - viewportPadding);

    tooltipStyle.value = {
        left: `${Math.round(left)}px`,
        top: `${Math.round(Math.max(viewportPadding, top))}px`
    };
}

onMounted(() => {
    window.addEventListener("resize", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);
});

onBeforeUnmount(() => {
    window.removeEventListener("resize", hideTooltip);
    window.removeEventListener("scroll", hideTooltip, true);
});
</script>

<template>
    <span
        ref="trigger"
        class="conflict-warning"
        role="img"
        tabindex="0"
        aria-label="Mod conflict warning"
        :aria-describedby="visible ? tooltipId : undefined"
        @mouseenter="showTooltip"
        @mouseleave="hideTooltip"
        @focus="showTooltip"
        @blur="hideTooltip"
        @keydown.esc="hideTooltip"
    >
        <WarningIcon />
    </span>

    <Teleport to="body">
        <Transition name="conflict-tooltip">
            <span
                v-if="visible"
                :id="tooltipId"
                ref="tooltip"
                class="conflict-tooltip"
                role="tooltip"
                :style="tooltipStyle"
            >
                <strong>Conflicting enabled mods</strong>
                <span>{{ props.message }}</span>
            </span>
        </Transition>
    </Teleport>
</template>

<style scoped>
.conflict-warning {
    display: inline-flex;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: #f0b36c;
    background: #332318;
    box-shadow: inset 0 0 0 1px #5a3d25;
    cursor: help;
    transition:
        color 140ms ease,
        background-color 140ms ease,
        transform 140ms ease;
}

.conflict-warning:hover,
.conflict-warning:focus-visible {
    color: #ffd19a;
    background: #432d1e;
    transform: translateY(-1px);
}

.conflict-warning:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.conflict-warning svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.conflict-tooltip {
    position: fixed;
    z-index: 10000;
    display: flex;
    width: max-content;
    max-width: min(360px, calc(100vw - 24px));
    flex-direction: column;
    gap: 5px;
    padding: 11px 13px;
    border: 1px solid #59412d;
    border-radius: 7px;
    color: #d8d4cb;
    background: #1b1713;
    box-shadow: 0 10px 30px rgb(0 0 0 / 45%);
    font-size: 13px;
    line-height: 1.45;
    pointer-events: none;
}

.conflict-tooltip strong {
    color: #f0b36c;
    font-size: 13px;
    font-weight: 700;
}

.conflict-tooltip-enter-active,
.conflict-tooltip-leave-active {
    transition:
        opacity 120ms ease,
        transform 120ms ease;
}

.conflict-tooltip-enter-from,
.conflict-tooltip-leave-to {
    opacity: 0;
    transform: translateY(3px);
}

@media (prefers-reduced-motion: reduce) {
    .conflict-warning,
    .conflict-tooltip-enter-active,
    .conflict-tooltip-leave-active {
        transition: none;
    }
}
</style>
