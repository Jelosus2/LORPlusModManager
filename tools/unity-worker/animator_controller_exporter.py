from animator_scene_exporter import object_id, property_pair, require_finite_float
from typing import Any


UINT32_MAX = 0xFFFFFFFF

MAXIMUM_ANIMATORS = 256
MAXIMUM_CONTROLLERS = 128
MAXIMUM_LAYERS = 256
MAXIMUM_STATE_MACHINES = 256
MAXIMUM_STATES = 4_096
MAXIMUM_TRANSITIONS = 16_384
MAXIMUM_BEHAVIOURS = 4_096

PARAMETER_TYPES = {
    1: "float",
    3: "int",
    4: "bool",
    9: "trigger"
}

CONDITION_MODES = {
    1: "if",
    2: "ifNot",
    3: "greater",
    4: "less",
    6: "equals",
    7: "notEqual"
}

BLENDING_MODES = {
    0: "override",
    1: "additive"
}


def unwrap_offset(value: Any) -> Any:
    if value is None:
        return None

    return getattr(value, "data", value)


def uint32(value: Any) -> int:
    return int(value) & UINT32_MAX


def finite_values(values: Any, context: str) -> list[float]:
    return [
        require_finite_float(value, f"{context} value {index}")
        for index, value in enumerate(values or [])
    ]


def named_hash(value: Any, names: dict[int, str]) -> dict | None:
    if value is None:
        return None

    hash_value = uint32(value)

    if hash_value == UINT32_MAX:
        return None

    return {
        "hash": hash_value,
        "name": names.get(hash_value)
    }


def optional_index(value: Any, count: int, context: str) -> int | None:
    index = uint32(value)

    if index == UINT32_MAX:
        return None

    if index >= count:
        raise ValueError(f"{context} references an invalid index.")

    return index


def required_index(value: Any, count: int, context: str) -> int:
    index = optional_index(value, count, context)

    if index is None:
        raise ValueError(f"{context} is missing.")

    return index


def read_parameter_default(defaults: Any, raw_type: int, index: int, context: str) -> bool | int | float | None:
    field_name = {
        1: "m_FloatValues",
        3: "m_IntValues",
        4: "m_BoolValues",
        9: "m_BoolValues"
    }.get(raw_type)

    if field_name is None:
        return None

    values = getattr(defaults, field_name, None) or []

    if index < 0 or index >= len(values):
        raise ValueError(f"{context} has an invalid default index.")

    value = values[index]

    if raw_type == 1:
        return require_finite_float(value, f"{context} default")

    if raw_type == 3:
        return int(value)

    return bool(value)


def export_blend_node(node: Any, node_index: int, clip_count: int, names: dict[int, str], context: str) -> dict:
    clip_index = optional_index(node.m_ClipID, clip_count, f"{context} clip")
    child_indices = [int(index) for index in node.m_ChildIndices]

    one_dimension = unwrap_offset(getattr(node, "m_Blend1dData", None))
    two_dimensions = unwrap_offset(getattr(node, "m_Blend2dData", None))
    direct = unwrap_offset(getattr(node, "m_BlendDirectData", None))

    blend_1d = None

    if one_dimension is not None:
        blend_1d = {
            "thresholds": finite_values(one_dimension.m_ChildThresholdArray, f"{context} 1D threshold")
        }

    blend_2d = None

    if two_dimensions is not None:
        positions = getattr(two_dimensions, "m_ChildPositionArray", None) or []
        neighbors = getattr(two_dimensions, "m_ChildNeighborListArray", None) or []

        blend_2d = {
            "positions": [
                [require_finite_float(position.x, f"{context} 2D position x"), require_finite_float(position.y, f"{context} 2D position y")]
                for position in positions
            ],
            "neighbors": [
                [int(index) for index in neighbor.m_NeighborArray]
                for neighbor in neighbors
            ],
            "thresholds": finite_values(getattr(two_dimensions, "m_ChildThresholdArray", None), f"{context} 2D threshold")
        }

    direct_data = None

    if direct is not None:
        direct_data = {
            "parameterHashes": [
                uint32(value)
                for value in direct.m_ChildBlendEventIDArray
            ],
            "normalized": bool(direct.m_NormalizedBlendValues)
        }

    return {
        "index": node_index,
        "clipIndex": clip_index,
        "serializedClipIndex": (
            int(node.m_ClipIndex)
            if getattr(node, "m_ClipIndex", None) is not None
            else None
        ),
        "duration": require_finite_float(node.m_Duration, f"{context} duration"),
        "cycleOffset": require_finite_float(getattr(node, "m_CycleOffset", 0) or 0, f"{context} cycle offset"),
        "mirror": bool(getattr(node, "m_Mirror", False)),
        "blendType": int(getattr(node, "m_BlendType", 0) or 0),
        "blendParameter": named_hash(node.m_BlendEventID, names),
        "blendParameterY": named_hash(getattr(node, "m_BlendEventYID", None), names),
        "childIndices": child_indices,
        "thresholds": finite_values(getattr(node, "m_ChildThresholdArray", None), f"{context} threshold"),
        "blend1d": blend_1d,
        "blend2d": blend_2d,
        "direct": direct_data
    }


def export_blend_tree(tree: Any, tree_index: int, clip_count: int, names: dict[int, str], context: str) -> dict:
    nodes = [unwrap_offset(value) for value in tree.m_NodeArray]

    for node_index, node in enumerate(nodes):
        if node is None:
            raise ValueError(f"{context} node {node_index} is missing.")

        for child_index in node.m_ChildIndices:
            if int(child_index) < 0 or int(child_index) >= len(nodes):
                raise ValueError(f"{context} node {node_index} has an invalid child.")

    return {
        "index": tree_index,
        "nodes": [
            export_blend_node(node, node_index, clip_count, names, f"{context} node {node_index}")
            for node_index, node in enumerate(nodes)
        ]
    }


def export_condition(condition: Any, names: dict[int, str], context: str) -> dict:
    raw_mode = int(condition.m_ConditionMode)

    return {
        "parameter": named_hash(condition.m_EventID, names),
        "mode": CONDITION_MODES.get(raw_mode, "unsupported"),
        "rawMode": raw_mode,
        "threshold": require_finite_float( condition.m_EventThreshold, f"{context} threshold"),
        "exitTime": require_finite_float(condition.m_ExitTime, f"{context} exit time")
    }


def export_transition(transition: Any, transition_index: int, state_count: int, names: dict[int, str], context: str) -> dict:
    return {
        "index": transition_index,
        "id": named_hash(transition.m_ID, names),
        "fullPath": named_hash(getattr(transition, "m_FullPathID", None), names),
        "userId": uint32(transition.m_UserID),
        "destinationStateIndex": optional_index(transition.m_DestinationState, state_count, f"{context} destination"),
        "duration": require_finite_float( transition.m_TransitionDuration, f"{context} duration"),
        "offset": require_finite_float(transition.m_TransitionOffset, f"{context} offset"),
        "hasExitTime": bool(getattr(transition, "m_HasExitTime", False)),
        "exitTime": require_finite_float(getattr(transition, "m_ExitTime", 0) or 0, f"{context} exit time"),
        "hasFixedDuration": bool(getattr(transition, "m_HasFixedDuration", False)),
        "canTransitionToSelf": bool(getattr(transition, "m_CanTransitionToSelf", False)),
        "atomic": bool(getattr(transition, "m_Atomic", False)),
        "interruptionSource": int(getattr(transition, "m_InterruptionSource", 0) or 0),
        "orderedInterruption": bool(getattr(transition, "m_OrderedInterruption", False)),
        "conditions": [
            export_condition(unwrap_offset(value), names, f"{context} condition {index}")
            for index, value in enumerate(transition.m_ConditionConstantArray)
        ]
    }


def export_state(state: Any, state_index: int, clip_count: int, names: dict[int, str], state_count: int, context: str) -> dict:
    blend_trees = [
        unwrap_offset(value)
        for value in state.m_BlendTreeConstantArray
    ]

    transitions = [
        unwrap_offset(value)
        for value in state.m_TransitionConstantArray
    ]

    return {
        "index": state_index,
        "name": named_hash(getattr(state, "m_NameID", None), names),
        "path": named_hash(getattr(state, "m_PathID", None), names),
        "fullPath": named_hash(getattr(state, "m_FullPathID", None), names),
        "id": named_hash(getattr(state, "m_ID", None), names),
        "tag": named_hash(state.m_TagID, names),
        "speed": require_finite_float(state.m_Speed, f"{context} speed"),
        "speedParameter": named_hash(getattr(state, "m_SpeedParamID", None), names),
        "timeParameter": named_hash(getattr(state, "m_TimeParamID", None), names),
        "cycleOffset": require_finite_float(getattr(state, "m_CycleOffset", 0) or 0, f"{context} cycle offset"),
        "cycleOffsetParameter": named_hash(getattr(state, "m_CycleOffsetParamID", None), names),
        "mirror": bool(getattr(state, "m_Mirror", False)),
        "mirrorParameter": named_hash(getattr(state, "m_MirrorParamID", None), names),
        "loop": bool(state.m_Loop),
        "ikOnFeet": bool(state.m_IKOnFeet),
        "writeDefaultValues": bool(getattr(state, "m_WriteDefaultValues", True)),
        "blendTreeIndices": [int(index) for index in state.m_BlendTreeConstantIndexArray],
        "blendTrees": [
            export_blend_tree(tree, tree_index, clip_count, names, f"{context} blend tree {tree_index}")
            for tree_index, tree in enumerate(blend_trees)
        ],
        "transitions": [
            export_transition(transition, transition_index, state_count, names, f"{context} transition {transition_index}")
            for transition_index, transition in enumerate(transitions)
        ]
    }


def export_state_machine(
    machine: Any,
    machine_index: int,
    clip_count: int,
    names: dict[int, str]
) -> dict:
    states = [
        unwrap_offset(value)
        for value in machine.m_StateConstantArray
    ]

    if any(state is None for state in states):
        raise ValueError(f"State machine {machine_index} contains a missing state.")

    state_count = len(states)

    default_state_index = (
        None
        if state_count == 0
        else required_index(machine.m_DefaultState, state_count, f"State machine {machine_index} default state")
    )

    return {
        "index": machine_index,
        "defaultStateIndex": default_state_index,
        "evaluateTransitionsOnStart": bool(getattr(machine, "m_EvaluateTransitionsOnStart", False)
        ),
        "states": [
            export_state(state, state_index, clip_count, names, state_count, f"State machine {machine_index} state {state_index}")
            for state_index, state in enumerate(states)
        ],
        "anyStateTransitions": [
            export_transition(unwrap_offset(value), transition_index, state_count, names, f"State machine {machine_index} any-state transition {transition_index}")
            for transition_index, value in enumerate(machine.m_AnyStateTransitionConstantArray)
        ]
    }


def export_parameters(controller_constant: Any, names: dict[int, str]) -> list[dict]:
    value_array = unwrap_offset(controller_constant.m_Values)
    defaults = unwrap_offset(controller_constant.m_DefaultValues)

    if value_array is None or defaults is None:
        return []

    parameters = []

    for parameter_index, parameter in enumerate(value_array.m_ValueArray):
        raw_type = int(parameter.m_Type)
        default_index = int(parameter.m_Index)
        parameter_hash = uint32(parameter.m_ID)

        parameters.append({
            "index": parameter_index,
            "nameHash": parameter_hash,
            "name": names.get(parameter_hash),
            "type": PARAMETER_TYPES.get(raw_type, "unsupported"),
            "rawType": raw_type,
            "defaultValue": read_parameter_default(defaults, raw_type, default_index, f"Parameter {parameter_index}")
        })

    return parameters


def export_behaviour(reader: Any, index: int) -> dict:
    behaviour = reader.parse_as_object()
    script_pointer = behaviour.m_Script

    class_name = None

    if script_pointer.path_id:
        class_name = script_pointer.deref().parse_as_object().m_ClassName

    result = {
        "index": index,
        "id": str(reader.path_id),
        "className": class_name,
        "kind": "unsupported"
    }

    if class_name != "MosaicStateBehaviour":
        return result

    tree = reader.read_typetree()
    raw_windows = tree.get("mosaicActiveTimeList", [])

    if not isinstance(raw_windows, list):
        raise ValueError("MosaicStateBehaviour has an invalid active-time list.")

    result.update({
        "kind": "mosaic",
        "mosaicOn": bool(tree.get("mosaicOn", False)),
        "activeWindows": [
            {
                "enter": require_finite_float(window.get("enterNormalizedTime"), "Mosaic behaviour enter time"),
                "exit": require_finite_float(window.get("exitNormalizedTime"), "Mosaic behaviour exit time")
            }
            for window in raw_windows
            if isinstance(window, dict)
        ]
    })

    if len(result["activeWindows"]) != len(raw_windows):
        raise ValueError("MosaicStateBehaviour contains an invalid active window.")

    return result


def export_behaviours(controller: Any) -> tuple[list[dict], list[dict]]:
    behaviour_pointers = getattr(controller, "m_StateMachineBehaviours", None) or []

    if len(behaviour_pointers) > MAXIMUM_BEHAVIOURS:
        raise ValueError("The Animator controller contains too many behaviours.")

    behaviours = []

    for index, pointer in enumerate(behaviour_pointers):
        if not pointer.path_id:
            raise ValueError("The Animator controller has a missing behaviour.")

        behaviours.append(export_behaviour(pointer.deref(), index))

    description = getattr(controller, "m_StateMachineBehaviourVectorDescription", None)

    if description is None:
        return behaviours, []

    indices = [int(index) for index in description.m_StateMachineBehaviourIndices]
    bindings = []

    for raw_pair in description.m_StateMachineBehaviourRanges:
        state_key, state_range = property_pair(raw_pair, "Animator state behaviour range")

        start = int(state_range.m_StartIndex)
        count = int(state_range.m_Count)
        end = start + count

        if start < 0 or count < 0 or end > len(indices):
            raise ValueError("The Animator controller has an invalid behaviour range.")

        behaviour_indices = indices[start:end]

        if any(index < 0 or index >= len(behaviours) for index in behaviour_indices):
            raise ValueError("The Animator controller has an invalid behaviour index.")

        bindings.append({
            "layerIndex": int(state_key.m_LayerIndex),
            "stateId": uint32(state_key.m_StateID),
            "behaviourIndices": behaviour_indices
        })

    return behaviours, bindings


def export_controller(controller_reader: Any) -> dict:
    controller = controller_reader.parse_as_object()
    controller_constant = controller.m_Controller

    names: dict[int, str] = {}

    for raw_pair in controller.m_TOS:
        raw_hash, name = property_pair(raw_pair, f'AnimatorController "{controller.m_Name}" name table')

        if isinstance(name, str):
            names[uint32(raw_hash)] = name

    clip_pointers = controller.m_AnimationClips
    clips = []

    for clip_index, pointer in enumerate(clip_pointers):
        clip_id = object_id(pointer)

        clips.append({
            "index": clip_index,
            "id": clip_id,
            "name": (
                pointer.deref().peek_name()
                if clip_id is not None
                else None
            )
        })

    raw_machines = [
        unwrap_offset(value)
        for value in controller_constant.m_StateMachineArray
    ]

    raw_layers = getattr(controller_constant, "m_LayerArray", None)

    if raw_layers is None:
        raw_layers = getattr(controller_constant, "m_HumanLayerArray", None) or []

    layers_data = [unwrap_offset(value) for value in raw_layers]

    if len(layers_data) > MAXIMUM_LAYERS:
        raise ValueError("The Animator controller contains too many layers.")

    if len(raw_machines) > MAXIMUM_STATE_MACHINES:
        raise ValueError("The Animator controller contains too many state machines.")

    state_machines = [
        export_state_machine(machine, machine_index, len(clips), names)
        for machine_index, machine in enumerate(raw_machines)
    ]

    total_states = sum(len(machine["states"]) for machine in state_machines)
    total_transitions = sum(
        len(state["transitions"])
        for machine in state_machines
        for state in machine["states"]
    ) + sum(
        len(machine["anyStateTransitions"])
        for machine in state_machines
    )

    if total_states > MAXIMUM_STATES:
        raise ValueError("The Animator controller contains too many states.")

    if total_transitions > MAXIMUM_TRANSITIONS:
        raise ValueError("The Animator controller contains too many transitions.")

    layer_count = len(layers_data)
    machine_count = len(raw_machines)
    layers = []

    for layer_index, layer in enumerate(layers_data):
        name_hash = uint32(layer.m_Binding)
        serialized_weight = require_finite_float(layer.m_DefaultWeight, f"Animator layer {layer_index} weight")
        raw_synchronized_index = int(getattr(layer, "m_StateMachineSynchronizedLayerIndex", 0) or 0)
        synchronized_index = None

        if raw_synchronized_index > 0:
            synchronized_index = required_index(raw_synchronized_index - 1, layer_count, f"Animator layer {layer_index} synchronized layer")

        raw_blending_mode = int(layer.m_LayerBlendingMode)

        layers.append({
            "index": layer_index,
            "nameHash": name_hash,
            "name": names.get(name_hash),
            "stateMachineIndex": required_index(layer.m_StateMachineIndex, machine_count, f"Animator layer {layer_index} state machine"),
            "serializedDefaultWeight": serialized_weight,
            "defaultWeight": 1.0 if layer_index == 0 else serialized_weight,
            "blendingMode": BLENDING_MODES.get(raw_blending_mode, "unsupported"),
            "rawBlendingMode": raw_blending_mode,
            "ikPass": bool(layer.m_IKPass),
            "synchronizedLayerIndex": synchronized_index,
            "synchronizedLayerAffectsTiming": bool(layer.m_SyncedLayerAffectsTiming),
            "motionSetIndex": (
                int(layer.m_StateMachineMotionSetIndex)
                if getattr(layer, "m_StateMachineMotionSetIndex", None) is not None
                else None
            )
        })

    behaviours, behaviour_bindings = export_behaviours(controller)

    for binding in behaviour_bindings:
        layer_index = binding["layerIndex"]

        if layer_index < 0 or layer_index >= len(layers):
            raise ValueError("A state behaviour references an invalid layer.")

    return {
        "id": str(controller_reader.path_id),
        "name": controller.m_Name,
        "evaluateTransitionsOnStart": bool(getattr(controller, "m_EvaluateTransitionsOnStart", False)),
        "clips": clips,
        "parameters": export_parameters(controller_constant, names),
        "layers": layers,
        "stateMachines": state_machines,
        "behaviours": behaviours,
        "stateBehaviourBindings": behaviour_bindings
    }


def export_animator_controllers(environment: Any, scene: dict) -> tuple[list[dict], list[dict]]:
    hierarchy_component_ids = {
        int(component["id"])
        for game_object in scene["gameObjects"]
        for component in game_object["components"]
    }

    animator_readers = sorted(
        (
            reader
            for reader in environment.objects
            if reader.type.name == "Animator" and int(reader.path_id) in hierarchy_component_ids
        ),
        key=lambda reader: int(reader.path_id)
    )

    if len(animator_readers) > MAXIMUM_ANIMATORS:
        raise ValueError("The Animator hierarchy contains too many Animator components.")

    animators = []
    controller_readers: dict[int, Any] = {}

    for reader in animator_readers:
        animator = reader.parse_as_object()
        controller_id = object_id(animator.m_Controller)

        if controller_id is not None:
            controller_reader = animator.m_Controller.deref()

            if controller_reader.type.name != "AnimatorController":
                raise ValueError("The Animator hierarchy uses an unsupported runtime controller type.")

            controller_readers[int(controller_reader.path_id)] = controller_reader

        animators.append({
            "id": str(reader.path_id),
            "gameObjectId": object_id(animator.m_GameObject),
            "controllerId": controller_id,
            "avatarId": object_id(animator.m_Avatar),
            "enabled": bool(animator.m_Enabled),
            "applyRootMotion": bool(animator.m_ApplyRootMotion),
            "cullingMode": int(animator.m_CullingMode),
            "updateMode": int(getattr(animator, "m_UpdateMode", 0) or 0),
            "animatePhysics": bool(getattr(animator, "m_AnimatePhysics", False)),
            "hasTransformHierarchy": bool(getattr(animator, "m_HasTransformHierarchy", True))
        })

    if len(controller_readers) > MAXIMUM_CONTROLLERS:
        raise ValueError("The Animator hierarchy references too many controllers.")

    controllers = [
        export_controller(reader)
        for _, reader in sorted(controller_readers.items())
    ]

    return animators, controllers
