export type AnimatorParameterIdentifier = string | number;

export type AnimatorHashReference = Readonly<{
    hash: number;
    name: string | null;
}>;

export type AnimatorParameterDefinition = Readonly<{
    index: number;
    nameHash: number;
    name: string | null;
    type: "float" | "int" | "bool" | "trigger" | "unsupported";
    rawType: number;
    defaultValue: number | boolean | null;
}>;

export type AnimatorConditionDefinition = Readonly<{
    parameter: AnimatorHashReference | null;
    mode:
        | "if"
        | "ifNot"
        | "greater"
        | "less"
        | "equals"
        | "notEqual"
        | "unsupported";
    rawMode: number;
    threshold: number;
    exitTime: number;
}>;

export type AnimatorTransitionDefinition = Readonly<{
    index: number;
    destinationStateIndex: number | null;
    duration: number;
    offset: number;
    hasExitTime: boolean;
    exitTime: number;
    hasFixedDuration: boolean;
    canTransitionToSelf: boolean;
    conditions: readonly AnimatorConditionDefinition[];
}>;

export type AnimatorBlendNodeDefinition = Readonly<{
    index: number;
    clipIndex: number | null;
    duration: number;
    cycleOffset: number;
    childIndices: readonly number[];
}>;

export type AnimatorBlendTreeDefinition = Readonly<{
    index: number;
    nodes: readonly AnimatorBlendNodeDefinition[];
}>;

export type AnimatorStateDefinition = Readonly<{
    index: number;
    name: AnimatorHashReference | null;
    path: AnimatorHashReference | null;
    fullPath: AnimatorHashReference | null;
    id: AnimatorHashReference | null;
    speed: number;
    speedParameter: AnimatorHashReference | null;
    cycleOffset: number;
    loop: boolean;
    blendTrees: readonly AnimatorBlendTreeDefinition[];
    transitions: readonly AnimatorTransitionDefinition[];
}>;

export type AnimatorStateMachineDefinition = Readonly<{
    index: number;
    defaultStateIndex: number | null;
    states: readonly AnimatorStateDefinition[];
    anyStateTransitions: readonly AnimatorTransitionDefinition[];
}>;

export type AnimatorLayerDefinition = Readonly<{
    index: number;
    stateMachineIndex: number;
    defaultWeight: number;
    blendingMode: "override" | "additive" | "unsupported";
}>;

export type AnimatorControllerClipDefinition = Readonly<{
    index: number;
    id: string | null;
    name: string | null;
}>;

export type AnimatorControllerDefinition = Readonly<{
    id: string;
    name: string;
    clips: readonly AnimatorControllerClipDefinition[];
    parameters: readonly AnimatorParameterDefinition[];
    layers: readonly AnimatorLayerDefinition[];
    stateMachines: readonly AnimatorStateMachineDefinition[];
}>;

export type AnimatorAnimationClipDefinition = Readonly<{
    pathId: string;
    name: string;
    duration: number;
    loop: boolean;
}>;

export type AnimatorClipSample = Readonly<{
    controllerId: string;
    layerIndex: number;
    stateMachineIndex: number;
    stateIndex: number;
    phase: "current" | "next";
    clipId: string;
    clipName: string;
    clipTime: number;
    normalizedTime: number;
    weight: number;
    layerWeight: number;
    blendingMode: AnimatorLayerDefinition["blendingMode"];
}>;

type ParameterValue = number | boolean;

type ResolvedMotion = Readonly<{
    clip: AnimatorAnimationClipDefinition;
    node: AnimatorBlendNodeDefinition;
}>;

type ActiveTransition = {
    definition: AnimatorTransitionDefinition;
    sourceStateIndex: number;
    sourceTime: number;
    destinationStateIndex: number;
    destinationTime: number;
    elapsed: number;
    duration: number;
};

type LayerState = {
    definition: AnimatorLayerDefinition;
    machine: AnimatorStateMachineDefinition;
    currentStateIndex: number | null;
    currentTime: number;
    transition: ActiveTransition | null;
};

export class AnimatorControllerEvaluator {
    private readonly EPSILON = 0.000001;
    private readonly MAXIMUM_AUTOMATIC_TRANSITIONS = 64;
    private readonly parametersByHash = new Map<number, AnimatorParameterDefinition>();
    private readonly parametersByName = new Map<string, AnimatorParameterDefinition>();
    private readonly parameterValues = new Map<number, ParameterValue>();
    private readonly clipsById = new Map<string, AnimatorAnimationClipDefinition>();
    private readonly resolvedMotions = new Map<string, ResolvedMotion | null>();
    private readonly layers: LayerState[];

    constructor(
        private readonly controller: AnimatorControllerDefinition,
        animationClips: readonly AnimatorAnimationClipDefinition[]
    ) {
        for (const clip of animationClips)
            this.clipsById.set(clip.pathId, clip);

        for (const parameter of controller.parameters)
        {
            if (this.parametersByHash.has(parameter.nameHash))
                throw new Error(`Animator controller "${controller.name}" contains duplicate parameter hashes.`);

            this.parametersByHash.set(parameter.nameHash, parameter);

            if (!parameter.name)
                continue;

            if (this.parametersByName.has(parameter.name))
                throw new Error(`Animator controller "${controller.name}" contains duplicate parameter names.`);

            this.parametersByName.set(parameter.name, parameter);
        }

        this.layers = controller.layers.map((layer) => {
            const machine = controller.stateMachines[layer.stateMachineIndex];
            if (!machine)
                throw new Error(`Animator layer ${layer.index} references an invalid state machine.`);

            return {
                definition: layer,
                machine,
                currentStateIndex: null,
                currentTime: 0,
                transition: null
            };
        });

        this.validateController();
        this.reset();
    }

    get id(): string {
        return this.controller.id;
    }

    get name(): string {
        return this.controller.name;
    }

    hasParameter(identifier: AnimatorParameterIdentifier, type?: AnimatorParameterDefinition["type"]): boolean {
        const parameter = this.findParameter(identifier);
        return parameter != null && (type === undefined || parameter.type === type);
    }

    setInteger(identifier: AnimatorParameterIdentifier, value: number) {
        if (!Number.isInteger(value))
            throw new Error("Animator integer parameters must be integers.");

        const parameter = this.requireParameter(identifier, "int");
        this.parameterValues.set(parameter.nameHash, value);
    }

    setFloat(identifier: AnimatorParameterIdentifier, value: number) {
        if (!Number.isFinite(value))
            throw new Error("Animator float parameters must be finite numbers.");

        const parameter = this.requireParameter(identifier, "float");
        this.parameterValues.set(parameter.nameHash, value);
    }

    setBoolean(identifier: AnimatorParameterIdentifier, value: boolean) {
        const parameter = this.requireParameter(identifier, "bool");
        this.parameterValues.set(parameter.nameHash, value);
    }

    setTrigger(identifier: AnimatorParameterIdentifier) {
        const parameter = this.requireParameter(identifier, "trigger");
        this.parameterValues.set(parameter.nameHash, true);
    }

    resetTrigger(identifier: AnimatorParameterIdentifier) {
        const parameter = this.requireParameter(identifier, "trigger");
        this.parameterValues.set(parameter.nameHash, false);
    }

    reset() {
        this.parameterValues.clear();

        for (const parameter of this.controller.parameters)
        {
            if (parameter.type === "unsupported")
                continue;

            const defaultValue = parameter.defaultValue ?? (
                parameter.type === "float" ||
                parameter.type === "int"
                    ? 0
                    : false
            );

            this.parameterValues.set(parameter.nameHash, defaultValue);
        }

        for (const layer of this.layers)
        {
            layer.currentStateIndex = this.resolveStableEntryStateIndex(layer.machine);
            layer.currentTime = 0;
            layer.transition = null;
        }
    }

    update(deltaSeconds: number): readonly AnimatorClipSample[] {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Animator update time must be a non-negative finite number.");

        const activeTriggerHashes = this.controller.parameters
            .filter((parameter) => parameter.type === "trigger" && this.parameterValues.get(parameter.nameHash) === true)
            .map((parameter) => parameter.nameHash);

        const consumedTriggerHashes = new Set<number>();

        for (const layer of this.layers)
        {
            for (const triggerHash of activeTriggerHashes)
                this.parameterValues.set(triggerHash, true);

            this.updateLayer(layer, deltaSeconds);

            for (const triggerHash of activeTriggerHashes)
            {
                if (this.parameterValues.get(triggerHash) !== true)
                    consumedTriggerHashes.add(triggerHash);
            }
        }

        for (const triggerHash of activeTriggerHashes)
            this.parameterValues.set(triggerHash, !consumedTriggerHashes.has(triggerHash));

        return this.getClipSamples();
    }

    getClipSamples(): readonly AnimatorClipSample[] {
        const samples: AnimatorClipSample[] = [];

        for (const layer of this.layers)
        {
            if (layer.currentStateIndex === null)
                continue;

            const transition = layer.transition;

            if (!transition)
            {
                this.appendStateSample(samples, layer, layer.currentStateIndex, layer.currentTime, 1, "current");
                continue;
            }

            const progress = transition.duration <= this.EPSILON
                ? 1
                : Math.min(1, Math.max(0, transition.elapsed / transition.duration));

            this.appendStateSample(samples, layer, transition.sourceStateIndex, transition.sourceTime, 1 - progress, "current");
            this.appendStateSample(samples, layer, transition.destinationStateIndex, transition.destinationTime, progress, "next");
        }

        return samples;
    }

    private updateLayer(layer: LayerState, deltaSeconds: number) {
        if (layer.currentStateIndex === null)
            return;

        if (layer.transition)
        {
            this.advanceTransition(layer, deltaSeconds);
            return;
        }

        const immediateTransition = this.findEligibleTransition(layer, layer.currentTime, layer.currentTime, false);

        if (immediateTransition)
        {
            this.startTransition(layer, immediateTransition);

            if (layer.transition)
                this.advanceTransition(layer, deltaSeconds);

            return;
        }

        const previousTime = layer.currentTime;
        const state = this.getCurrentState(layer);

        layer.currentTime = this.advanceStateTime(state, layer.currentTime, deltaSeconds);

        const exitTransition = this.findEligibleTransition(layer, previousTime, layer.currentTime, true);
        if (exitTransition)
            this.startTransition(layer, exitTransition);
    }

    private advanceTransition(layer: LayerState, deltaSeconds: number) {
        const transition = layer.transition;

        if (!transition)
            return;

        const sourceState = this.requireState(layer.machine, transition.sourceStateIndex);
        const destinationState = this.requireState(layer.machine, transition.destinationStateIndex);

        transition.sourceTime = this.advanceStateTime(sourceState, transition.sourceTime, deltaSeconds);
        transition.destinationTime = this.advanceStateTime(destinationState, transition.destinationTime, deltaSeconds);
        transition.elapsed += deltaSeconds;

        if (transition.duration > this.EPSILON && transition.elapsed + this.EPSILON < transition.duration)
            return;

        layer.currentStateIndex = transition.destinationStateIndex;
        layer.currentTime = transition.destinationTime;
        layer.transition = null;

        this.settleImmediateTransitions(layer);
    }

    private startTransition(layer: LayerState, definition: AnimatorTransitionDefinition) {
        if (layer.currentStateIndex === null || definition.destinationStateIndex === null)
            return;

        const sourceStateIndex = layer.currentStateIndex;
        const destinationStateIndex = definition.destinationStateIndex;

        if (sourceStateIndex === destinationStateIndex && !definition.canTransitionToSelf)
            return;

        const sourceState = this.requireState(layer.machine, sourceStateIndex);
        const destinationState = this.requireState(layer.machine, destinationStateIndex);
        const sourceDuration = this.getStateDuration(sourceState);
        const destinationDuration = this.getStateDuration(destinationState);

        const transitionDuration = Math.max(
            0,
            definition.hasFixedDuration
                ? definition.duration
                : definition.duration * sourceDuration
        );

        this.consumeTransitionTriggers(definition);

        if (transitionDuration <= this.EPSILON)
        {
            layer.currentStateIndex = destinationStateIndex;
            layer.currentTime = Math.max(0, definition.offset * destinationDuration);
            layer.transition = null;
            return;
        }

        layer.transition = {
            definition,
            sourceStateIndex,
            sourceTime: layer.currentTime,
            destinationStateIndex,
            destinationTime: Math.max(0, definition.offset * destinationDuration),
            elapsed: 0,
            duration: transitionDuration
        };
    }

    private settleImmediateTransitions(layer: LayerState) {
        for (let attempt = 0; attempt < this.MAXIMUM_AUTOMATIC_TRANSITIONS; attempt++) {
            if (layer.currentStateIndex === null || layer.transition !== null)
                return;

            const transition = this.findEligibleTransition(layer, layer.currentTime, layer.currentTime, false);
            if (!transition)
                return;

            this.startTransition(layer, transition);
        }

        throw new Error(`Animator controller "${this.controller.name}" contains an immediate transition cycle.`);
    }

    private findEligibleTransition(layer: LayerState, previousTime: number, currentTime: number, includeExitTransitions: boolean): AnimatorTransitionDefinition | null {
        if (layer.currentStateIndex === null)
            return null;

        const state = this.getCurrentState(layer);
        const candidates = [
            ...layer.machine.anyStateTransitions,
            ...state.transitions
        ];

        for (const transition of candidates)
        {
            if (transition.destinationStateIndex === null)
                continue;
            if (transition.destinationStateIndex === layer.currentStateIndex && !transition.canTransitionToSelf)
                continue;

            if (transition.hasExitTime)
            {
                if (!includeExitTransitions || !this.hasReachedExitTime(state, previousTime, currentTime, transition.exitTime))
                    continue;
            }

            if (!this.conditionsPass(transition.conditions))
                continue;

            return transition;
        }

        return null;
    }

    private conditionsPass(conditions: readonly AnimatorConditionDefinition[]): boolean {
        for (const condition of conditions)
        {
            const parameterReference = condition.parameter;
            if (!parameterReference)
                return false;

            const parameter = this.parametersByHash.get(parameterReference.hash);
            if (!parameter)
                return false;

            const value = this.parameterValues.get(parameter.nameHash);

            switch (condition.mode)
            {
                case "if":
                    if (value !== true)
                        return false;
                    break;

                case "ifNot":
                    if (value !== false)
                        return false;
                    break;

                case "greater":
                    if (typeof value !== "number" || value <= condition.threshold)
                        return false;
                    break;

                case "less":
                    if (typeof value !== "number" || value >= condition.threshold)
                        return false;
                    break;

                case "equals":
                    if (typeof value !== "number" || value !== condition.threshold)
                        return false;
                    break;

                case "notEqual":
                    if (typeof value !== "number" || value === condition.threshold)
                        return false;
                    break;

                default:
                    return false;
            }
        }

        return true;
    }

    private consumeTransitionTriggers(transition: AnimatorTransitionDefinition) {
        for (const condition of transition.conditions)
        {
            if (!condition.parameter)
                continue;

            const parameter = this.parametersByHash.get(condition.parameter.hash);
            if (parameter?.type === "trigger")
                this.parameterValues.set(parameter.nameHash, false);
        }
    }

    private hasReachedExitTime(state: AnimatorStateDefinition, previousTime: number, currentTime: number, exitTime: number): boolean {
        const duration = this.getStateDuration(state);

        if (duration <= this.EPSILON)
            return true;

        const previousNormalized = previousTime / duration;
        const currentNormalized = currentTime / duration;

        if (currentNormalized + this.EPSILON < previousNormalized)
            return false;
        if (!state.loop || exitTime >= 1)
            return previousNormalized <= exitTime + this.EPSILON && currentNormalized + this.EPSILON >= exitTime;

        let target = Math.floor(previousNormalized) + exitTime;

        if (target + this.EPSILON < previousNormalized)
            target += 1;

        return currentNormalized + this.EPSILON >= target;
    }

    private advanceStateTime(state: AnimatorStateDefinition, currentTime: number, deltaSeconds: number): number {
        const speed = this.getStateSpeed(state);
        return Math.max(0, currentTime + deltaSeconds * speed);
    }

    private getStateSpeed(state: AnimatorStateDefinition): number {
        const parameterReference = state.speedParameter;

        if (parameterReference)
        {
            const value = this.parameterValues.get(parameterReference.hash);

            if (typeof value === "number")
                return state.speed * value;
        }

        return state.speed;
    }

    private getStateDuration(state: AnimatorStateDefinition): number {
        return this.resolveMotion(state)?.clip.duration ?? 0;
    }

    private resolveMotion(state: AnimatorStateDefinition): ResolvedMotion | null {
        const key = `${state.index}:${state.fullPath?.hash ?? state.path?.hash ?? state.name?.hash ?? 0}`;
        const cached = this.resolvedMotions.get(key);

        if (cached !== undefined)
            return cached;

        if (state.blendTrees.length === 0)
        {
            this.resolvedMotions.set(key, null);
            return null;
        }

        if (state.blendTrees.length !== 1)
            throw new Error(`Animator state "${state.name?.name ?? state.index}" uses multiple blend trees.`);

        const tree = state.blendTrees[0];
        if (tree.nodes.length !== 1 || tree.nodes[0].childIndices.length !== 0)
            throw new Error(`Animator state "${state.name?.name ?? state.index}" uses an unsupported blend tree.`);

        const node = tree.nodes[0];

        if (node.clipIndex === null)
        {
            this.resolvedMotions.set(key, null);
            return null;
        }

        const controllerClip = this.controller.clips[node.clipIndex];
        if (!controllerClip?.id)
            throw new Error(`Animator state "${state.name?.name ?? state.index}" references an invalid controller clip.`);

        const clip = this.clipsById.get(controllerClip.id);
        if (!clip)
            throw new Error(`Animator clip "${controllerClip.name ?? controllerClip.id}" is missing from the runtime package.`);

        const motion = { clip, node };

        this.resolvedMotions.set(key, motion);
        return motion;
    }

    private resolveStableEntryStateIndex(machine: AnimatorStateMachineDefinition): number | null {
        let stateIndex = machine.defaultStateIndex;
        const visitedStates = new Set<number>();

        while (stateIndex !== null)
        {
            if (visitedStates.has(stateIndex))
                return stateIndex;

            visitedStates.add(stateIndex);

            const state = this.requireState(machine, stateIndex);
            if (state.loop)
                return stateIndex;

            const completionTransition = state.transitions.find((transition) =>
                transition.destinationStateIndex !== null &&
                transition.hasExitTime &&
                transition.conditions.length === 0
            );

            if (!completionTransition)
                return stateIndex;

            stateIndex = completionTransition.destinationStateIndex;
        }

        return null;
    }

    private appendStateSample(
        destination: AnimatorClipSample[],
        layer: LayerState,
        stateIndex: number,
        stateTime: number,
        stateWeight: number,
        phase: AnimatorClipSample["phase"]
    ) {
        const state = this.requireState(layer.machine, stateIndex);
        const motion = this.resolveMotion(state);

        if (!motion || stateWeight <= this.EPSILON)
            return;

        const duration = motion.clip.duration;
        const hasDuration = duration > this.EPSILON;

        const clipTime = hasDuration
            ? state.loop
                ? this.positiveModulo(stateTime + (state.cycleOffset + motion.node.cycleOffset) * duration, duration)
                : Math.min(duration, Math.max(0, stateTime + (state.cycleOffset + motion.node.cycleOffset) * duration))
            : 0;

        destination.push({
            controllerId: this.controller.id,
            layerIndex: layer.definition.index,
            stateMachineIndex: layer.machine.index,
            stateIndex,
            phase,
            clipId: motion.clip.pathId,
            clipName: motion.clip.name,
            clipTime,
            normalizedTime: hasDuration
                ? stateTime / duration
                : 0,
            weight: stateWeight * layer.definition.defaultWeight,
            layerWeight: layer.definition.defaultWeight,
            blendingMode: layer.definition.blendingMode
        });
    }

    private getCurrentState(layer: LayerState): AnimatorStateDefinition {
        if (layer.currentStateIndex === null)
            throw new Error("The Animator layer has no active state.");

        return this.requireState(layer.machine, layer.currentStateIndex);
    }

    private requireState(machine: AnimatorStateMachineDefinition, index: number): AnimatorStateDefinition {
        const state = machine.states[index];
        if (!state)
            throw new Error(`Animator state machine ${machine.index} references state ${index}, which does not exist.`);

        return state;
    }

    private findParameter(identifier: AnimatorParameterIdentifier): AnimatorParameterDefinition | null {
        return typeof identifier === "number"
            ? this.parametersByHash.get(identifier) ?? null
            : this.parametersByName.get(identifier) ?? null;
    }

    private requireParameter(identifier: AnimatorParameterIdentifier, expectedType: AnimatorParameterDefinition["type"]): AnimatorParameterDefinition {
        const parameter = this.findParameter(identifier);

        if (!parameter)
            throw new Error(`Animator parameter "${identifier}" does not exist.`);
        if (parameter.type !== expectedType)
            throw new Error(`Animator parameter "${identifier}" is not a ${expectedType} parameter.`);

        return parameter;
    }

    private validateController() {
        for (const layer of this.layers)
        {
            if (layer.machine.defaultStateIndex !== null && !layer.machine.states[layer.machine.defaultStateIndex])
                throw new Error(`Animator layer ${layer.definition.index} has an invalid default state.`);

            for (const state of layer.machine.states)
                this.resolveMotion(state);
        }
    }

    private positiveModulo(value: number, divisor: number): number {
        return ((value % divisor) + divisor) % divisor;
    }
}
