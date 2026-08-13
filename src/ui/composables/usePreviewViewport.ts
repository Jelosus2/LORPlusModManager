import type { Application, Container } from "pixi.js";

import { ref } from "vue";

export type PreviewBounds = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type PreviewFit = Readonly<{
    bounds: PreviewBounds;
    mode?: "contain" | "cover";
    zoom?: number;
    padding?: number;
}>;

type PreviewViewportOptions = Readonly<{
    getApplication: () => Application | null;
    getHost: () => HTMLElement | null;
    getScene: () => Container | null;
    getFit: () => PreviewFit | null;
    scaleYDirection?: 1 | -1;
}>;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_SENSITIVITY = 0.0015;
const DRAG_THRESHOLD = 4;

export function usePreviewViewport(options: PreviewViewportOptions) {
    const isPanning = ref(false);
    const didDragPreview = ref(false);
    const previewZoom = ref(100);

    const scaleYDirection = options.scaleYDirection ?? 1;

    let fittedScale = 0;
    let activePointerId: number | null = null;
    let panTarget: HTMLElement | null = null;
    let panStartX = 0;
    let panStartY = 0;
    let panLastX = 0;
    let panLastY = 0;
    let dragResetTimer: number | null = null;

    function fitPreview() {
        const application = options.getApplication();
        const scene = options.getScene();
        const fit = options.getFit();

        if (!application || !scene || !fit)
            return;

        const { bounds } = fit;

        if (bounds.width <= 0 || bounds.height <= 0)
            return;

        const screenWidth = application.screen.width;
        const screenHeight = application.screen.height;
        const padding = Math.max(0, fit.padding ?? 72);
        const zoom = fit.zoom && fit.zoom > 0
            ? fit.zoom
            : 1;

        const availableWidth = Math.max(screenWidth - padding * 2, 1);
        const availableHeight = Math.max(screenHeight - padding * 2, 1);
        const widthScale = availableWidth / bounds.width;
        const heightScale = availableHeight / bounds.height;

        const baseScale = fit.mode === "cover"
            ? Math.max(widthScale, heightScale)
            : Math.min(widthScale, heightScale);

        fittedScale = baseScale / zoom;

        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const scaleY = fittedScale * scaleYDirection;

        scene.scale.set(fittedScale, scaleY);
        scene.position.set(screenWidth / 2 - centerX * fittedScale, screenHeight / 2 - centerY * scaleY);

        previewZoom.value = 100;
    }

    function resetPreviewView() {
        fitPreview();
    }

    function handlePreviewWheel(event: WheelEvent) {
        const application = options.getApplication();
        const host = options.getHost();
        const scene = options.getScene();

        if (!application || !host || !scene || fittedScale <= 0)
            return;

        const hostBounds = host.getBoundingClientRect();
        if (hostBounds.width <= 0 || hostBounds.height <= 0)
            return;

        const pointerX = (event.clientX - hostBounds.left) * application.screen.width / hostBounds.width;
        const pointerY = (event.clientY - hostBounds.top) * application.screen.height / hostBounds.height;

        const deltaMultiplier =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                    ? hostBounds.height
                    : 1;

        const normalizedDelta = event.deltaY * deltaMultiplier;
        const currentScaleX = scene.scale.x;
        const currentScaleY = scene.scale.y;

        if (currentScaleX === 0 || currentScaleY === 0)
            return;

        const currentZoom = Math.abs(currentScaleX) / fittedScale;
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * Math.exp(-normalizedDelta * ZOOM_SENSITIVITY)));
        const nextScaleX = fittedScale * nextZoom;
        const nextScaleY = nextScaleX * scaleYDirection;

        if (Math.abs(nextScaleX - currentScaleX) < 0.0001)
            return;

        const localPointerX = (pointerX - scene.position.x) / currentScaleX;
        const localPointerY = (pointerY - scene.position.y) / currentScaleY;

        scene.scale.set(nextScaleX, nextScaleY);
        scene.position.set(pointerX - localPointerX * nextScaleX, pointerY - localPointerY * nextScaleY);

        previewZoom.value = Math.round(nextZoom * 100);
    }

    function startPreviewPan(event: PointerEvent) {
        if (!options.getScene() || activePointerId !== null || (event.button !== 0 && event.button !== 1))
            return;

        const target = event.currentTarget;
        if (!(target instanceof HTMLElement))
            return;

        if (dragResetTimer !== null) {
            window.clearTimeout(dragResetTimer);
            dragResetTimer = null;
        }

        activePointerId = event.pointerId;
        panTarget = target;
        panStartX = event.clientX;
        panStartY = event.clientY;
        panLastX = event.clientX;
        panLastY = event.clientY;
        isPanning.value = false;
        didDragPreview.value = false;

        if (event.button === 1)
            event.preventDefault();
    }

    function movePreviewPan(event: PointerEvent) {
        const application = options.getApplication();
        const scene = options.getScene();

        if (!application || !scene || activePointerId !== event.pointerId || !panTarget)
            return;

        const bounds = panTarget.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0)
            return;

        if (!didDragPreview.value) {
            const distance = Math.hypot(event.clientX - panStartX, event.clientY - panStartY);
            if (distance < DRAG_THRESHOLD)
                return;

            didDragPreview.value = true;
            isPanning.value = true;

            if (!panTarget.hasPointerCapture(event.pointerId))
                panTarget.setPointerCapture(event.pointerId);
        }

        scene.position.x += (event.clientX - panLastX) * application.screen.width / bounds.width;
        scene.position.y += (event.clientY - panLastY) * application.screen.height / bounds.height;

        panLastX = event.clientX;
        panLastY = event.clientY;

        event.preventDefault();
    }

    function finishPreviewPan(event: PointerEvent) {
        if (activePointerId !== event.pointerId)
            return;

        const pointerId = activePointerId;

        if (panTarget?.hasPointerCapture(pointerId))
            panTarget.releasePointerCapture(pointerId);

        activePointerId = null;
        panTarget = null;
        isPanning.value = false;

        dragResetTimer = window.setTimeout(() => {
            didDragPreview.value = false;
            dragResetTimer = null;
        }, 0);
    }

    function resetPointerInteraction() {
        if (activePointerId !== null && panTarget?.hasPointerCapture(activePointerId))
            panTarget.releasePointerCapture(activePointerId);

        if (dragResetTimer !== null)
            window.clearTimeout(dragResetTimer);

        dragResetTimer = null;
        activePointerId = null;
        panTarget = null;
        isPanning.value = false;
        didDragPreview.value = false;
    }

    return {
        isPanning,
        didDragPreview,
        previewZoom,
        fitPreview,
        resetPreviewView,
        handlePreviewWheel,
        startPreviewPan,
        movePreviewPan,
        finishPreviewPan,
        resetPointerInteraction
    };
}
