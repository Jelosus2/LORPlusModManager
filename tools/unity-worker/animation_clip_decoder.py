from collections import Counter
from io import BytesIO
from typing import Any
import struct
import math


TRANSFORM_TYPE_ID = 4
SKINNED_MESH_RENDERER_TYPE_ID = 137

MAX_STREAM_WORDS = 16_000_000
MAX_STREAMED_FRAMES = 1_000_000
MAX_KEYS_PER_FRAME = 1_000_000
MAX_SCALAR_CURVES = 1_000_000
MAX_DENSE_SAMPLES = 100_000_000

FRAME_HEADER = struct.Struct("<fi")
STREAMED_KEY = struct.Struct("<i4f")

TRANSFORM_COMPONENTS = {
    1: ("x", "y", "z"),       # Position
    2: ("x", "y", "z", "w"),  # Quaternion
    3: ("x", "y", "z"),       # Scale
    4: ("x", "y", "z"),       # Euler
}


def binding_component_names(binding: Any) -> tuple[str, ...]:
    type_id = int(binding.typeID)
    attribute = int(binding.attribute)

    if type_id == TRANSFORM_TYPE_ID:
        return TRANSFORM_COMPONENTS.get(attribute, ("value",))

    return ("value",)


def read_exact(reader: BytesIO, size: int, context: str) -> bytes:
    data = reader.read(size)

    if len(data) != size:
        raise ValueError(f"{context} is truncated.")

    return data


def decode_streamed_frames(streamed_clip: Any, maximum_curve_count: int) -> list[dict]:
    curve_count = int(streamed_clip.curveCount)
    words = list(streamed_clip.data)

    if curve_count < 0 or curve_count > MAX_SCALAR_CURVES:
        raise ValueError("The streamed animation has an invalid curve count.")

    if len(words) > MAX_STREAM_WORDS:
        raise ValueError("The streamed animation data is too large.")

    if not words:
        if curve_count:
            raise ValueError("The streamed animation has no frame data.")

        return []

    raw = struct.pack(f"<{len(words)}I", *(int(word) & 0xFFFFFFFF for word in words))
    reader = BytesIO(raw)
    frames: list[dict] = []

    while reader.tell() < len(raw):
        if len(frames) >= MAX_STREAMED_FRAMES:
            raise ValueError("The streamed animation has too many frames.")

        time, key_count = FRAME_HEADER.unpack(read_exact(reader, FRAME_HEADER.size, "A streamed animation frame"))
        remaining = len(raw) - reader.tell()
        maximum_key_count = remaining // STREAMED_KEY.size

        if key_count < 0 or key_count > MAX_KEYS_PER_FRAME or key_count > maximum_key_count:
            raise ValueError("A streamed animation frame has an invalid key count.")

        keys = []

        for _ in range(key_count):
            scalar_index, c0, c1, c2, c3 = STREAMED_KEY.unpack(read_exact(reader, STREAMED_KEY.size, "A streamed animation key"))

            if scalar_index < 0 or scalar_index >= maximum_curve_count:
                raise ValueError("A streamed animation key references an invalid curve.")

            keys.append({
                "scalarIndex": scalar_index,
                "value": c3,
                "coefficients": (c0, c1, c2, c3)
            })

        frames.append({
            "time": float(time),
            "keys": keys
        })

    if len(frames) == 1:
        frame = frames[0]
        time = frame["time"]

        if curve_count == 0 and not frame["keys"] and math.isinf(time) and time > 0:
            return frames

        raise ValueError("The streamed animation is missing its sentinel frames.")

    if len(frames) < 2:
        raise ValueError("The streamed animation is missing its sentinel frames.")

    first_time = frames[0]["time"]
    last_time = frames[-1]["time"]

    if first_time > -3.0e38:
        raise ValueError("The streamed animation has an invalid starting sentinel.")

    if not math.isinf(last_time) or last_time < 0:
        raise ValueError("The streamed animation has an invalid ending sentinel.")

    playable_frames = frames[1:-1]
    previous_time = -math.inf

    for frame in playable_frames:
        time = frame["time"]

        if not math.isfinite(time) or time < previous_time:
            raise ValueError("The streamed animation frame times are invalid.")

        previous_time = time

    return frames


def build_binding_descriptors(binding_constant: Any) -> tuple[list[dict], list[tuple[int, int]], dict[int, tuple[int, int, bool]]]:
    descriptors: list[dict] = []
    numeric_scalar_map: list[tuple[int, int]] = []
    scalar_lookup: dict[int, tuple[int, int, bool]] = {}
    scalar_start = 0

    for binding_index, binding in enumerate(binding_constant.genericBindings):
        component_names = binding_component_names(binding)
        component_count = len(component_names)
        is_pptr_curve = bool(binding.isPPtrCurve)

        descriptor = {
            "bindingIndex": binding_index,
            "scalarStart": scalar_start,
            "scalarCount": component_count,
            "components": component_names,
            "pathHash": int(binding.path),
            "attributeHash": int(binding.attribute),
            "typeId": int(binding.typeID),
            "customType": int(binding.customType),
            "isPPtrCurve": is_pptr_curve,
            "isIntCurve": bool(getattr(binding, "isIntCurve", 0)),
            "isSerializeReferenceCurve": bool(getattr(binding, "isSerializeReferenceCurve", 0)),
            "script": decode_object_reference(binding.script, f"Animation binding {binding_index} script"),
        }

        descriptors.append(descriptor)

        for component_index in range(component_count):
            scalar_index = scalar_start + component_index
            scalar_lookup[scalar_index] = (binding_index, component_index, is_pptr_curve,)

            if not is_pptr_curve:
                numeric_scalar_map.append((binding_index, component_index))

        scalar_start += component_count

        if scalar_start > MAX_SCALAR_CURVES:
            raise ValueError("The animation has too many scalar curves.")

    return descriptors, numeric_scalar_map, scalar_lookup


def decode_animation_clip(clip: Any) -> dict:
    if bool(clip.m_Legacy):
        raise ValueError(f'AnimationClip "{clip.m_Name}" uses the unsupported legacy format.')

    muscle_clip = getattr(clip, "m_MuscleClip", None)
    if muscle_clip is None:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has no optimized clip data.')

    binding_constant = getattr(clip, "m_ClipBindingConstant", None)
    if binding_constant is None:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has no binding table.')

    duration = float(muscle_clip.m_StopTime)
    sample_rate = float(clip.m_SampleRate)

    if not math.isfinite(duration) or duration < 0:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has an invalid duration.')

    if not math.isfinite(sample_rate) or sample_rate <= 0:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has an invalid sample rate.')

    optimized_clip = muscle_clip.m_Clip.data
    streamed_clip = optimized_clip.m_StreamedClip
    dense_clip = optimized_clip.m_DenseClip
    constant_clip = optimized_clip.m_ConstantClip

    streamed_count = int(streamed_clip.curveCount)
    dense_count = int(dense_clip.m_CurveCount)
    constant_values = list(constant_clip.data) if constant_clip else []
    constant_count = len(constant_values)
    scalar_count = streamed_count + dense_count + constant_count

    descriptors, scalar_map, scalar_lookup = build_binding_descriptors(binding_constant)

    if len(scalar_map) != scalar_count:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has {scalar_count} stored scalar curves but its numeric bindings describe {len(scalar_map)}.')

    pptr_scalar_indices = [
        scalar_index
        for scalar_index, (_, _, is_pptr_curve) in scalar_lookup.items()
        if is_pptr_curve
    ]

    if pptr_scalar_indices:
        expected_pptr_indices = list(range(streamed_count, streamed_count + len(pptr_scalar_indices)))

        if pptr_scalar_indices != expected_pptr_indices:
            raise ValueError(f'AnimationClip "{clip.m_Name}" uses an unsupported object-reference curve layout.')

    scalar_curves = []

    for scalar_index, (binding_index, component_index) in enumerate(scalar_map):
        if scalar_index < streamed_count:
            storage = "streamed"
        elif scalar_index < streamed_count + dense_count:
            storage = "dense"
        else:
            storage = "constant"

        scalar_curves.append({
            "bindingIndex": binding_index,
            "componentIndex": component_index,
            "storage": storage,
            "keys": []
        })

    numeric_curves_by_binding = {
        (curve["bindingIndex"], curve["componentIndex"]): curve
        for curve in scalar_curves
    }

    object_reference_curves_by_binding = {
        descriptor["bindingIndex"]: {
            "bindingIndex": descriptor["bindingIndex"],
            "keys": []
        }
        for descriptor in descriptors
        if descriptor["isPPtrCurve"]
    }

    streamed_frames = decode_streamed_frames(
        streamed_clip,
        len(scalar_lookup)
    )

    mapping_count = len(binding_constant.pptrCurveMapping)

    for frame_index, frame in enumerate(streamed_frames[:-1]):
        is_initial_sentinel = frame_index == 0
        time = 0.0 if is_initial_sentinel else frame["time"]

        for key in frame["keys"]:
            scalar_binding = scalar_lookup.get(key["scalarIndex"])

            if scalar_binding is None:
                raise ValueError(f'AnimationClip "{clip.m_Name}" references an unknown binding scalar.')

            binding_index, component_index, is_pptr_curve = scalar_binding

            if is_pptr_curve:
                raw_mapping_index = key["value"]
                mapping_index = round(raw_mapping_index)

                if not math.isfinite(raw_mapping_index) or abs(raw_mapping_index - mapping_index) > 0.0001:
                    raise ValueError(f'AnimationClip "{clip.m_Name}" has a non-integer object-reference mapping index.')

                if mapping_index < 0:
                    mapping_index = -1
                elif mapping_index >= mapping_count:
                    raise ValueError(f'AnimationClip "{clip.m_Name}" references an invalid object-reference mapping.')

                object_reference_curves_by_binding[binding_index]["keys"].append({
                    "time": time,
                    "mappingIndex": mapping_index
                })

                continue

            if is_initial_sentinel:
                continue

            curve = numeric_curves_by_binding.get((
                binding_index,
                component_index
            ))

            if curve is None:
                raise ValueError(f'AnimationClip "{clip.m_Name}" could not resolve a numeric streamed curve.')

            curve["keys"].append({
                "time": time,
                "value": key["value"],
                "coefficients": key["coefficients"],
            })

    object_reference_curves = list(
        object_reference_curves_by_binding.values()
    )

    dense_frame_count = int(dense_clip.m_FrameCount)
    dense_sample_rate = float(dense_clip.m_SampleRate)
    dense_samples = list(dense_clip.m_SampleArray)

    if dense_frame_count < 0:
        raise ValueError("The dense animation has an invalid frame count.")

    if dense_frame_count and (not math.isfinite(dense_sample_rate) or dense_sample_rate <= 0):
        raise ValueError("The dense animation has an invalid sample rate.")

    expected_dense_samples = dense_frame_count * dense_count

    if expected_dense_samples > MAX_DENSE_SAMPLES:
        raise ValueError("The dense animation data is too large.")

    if len(dense_samples) != expected_dense_samples:
        raise ValueError(f'AnimationClip "{clip.m_Name}" has an invalid dense sample array.')

    dense_begin_time = float(dense_clip.m_BeginTime)

    for frame_index in range(dense_frame_count):
        time = dense_begin_time + frame_index / dense_sample_rate
        frame_offset = frame_index * dense_count

        for dense_index in range(dense_count):
            scalar_index = streamed_count + dense_index

            scalar_curves[scalar_index]["keys"].append({
                "time": time,
                "value": float(dense_samples[frame_offset + dense_index]),
            })

    constant_start = streamed_count + dense_count

    for constant_index, value in enumerate(constant_values):
        scalar_index = constant_start + constant_index
        keys = [{"time": 0.0, "value": float(value)}]

        if duration > 0:
            keys.append({"time": duration, "value": float(value)})

        scalar_curves[scalar_index]["keys"].extend(keys)

    events = []

    for event in clip.m_Events:
        events.append({
            "time": float(event.time),
            "functionName": event.functionName,
            "stringParameter": event.data,
            "floatParameter": float(event.floatParameter),
            "intParameter": int(event.intParameter),
            "messageOptions": int(event.messageOptions),
        })

    pptr_curve_mapping = [
        decode_object_reference(pointer, f'AnimationClip "{clip.m_Name}" object-reference mapping {index}')
        for index, pointer in enumerate(binding_constant.pptrCurveMapping)
    ]

    return {
        "name": clip.m_Name,
        "duration": duration,
        "sampleRate": sample_rate,
        "loop": bool(muscle_clip.m_LoopTime),
        "wrapMode": int(clip.m_WrapMode),
        "bindings": descriptors,
        "scalarCurves": scalar_curves,
        "events": events,
        "pptrCurveMapping": pptr_curve_mapping,
        "objectReferenceCurves": object_reference_curves,
        "storageCounts": {
            "streamed": streamed_count,
            "dense": dense_count,
            "constant": constant_count,
        },
    }


def decode_object_reference(pointer: Any, context: str) -> dict | None:
    path_id = int(pointer.path_id)

    if path_id == 0:
        return None

    try:
        reader = pointer.deref()
    except Exception as error:
        raise ValueError(f"{context} references an unavailable Unity object.") from error

    result = {
        "fileId": int(pointer.file_id),
        "pathId": str(reader.path_id),
        "type": reader.type.name,
        "className": None,
    }

    if reader.type.name == "MonoScript":
        script = reader.parse_as_object()
        result["className"] = script.m_ClassName

    return result


def summarize_animation_clip(decoded: dict) -> dict:
    binding_types = Counter(binding["typeId"] for binding in decoded["bindings"])
    sample_counts = Counter()

    for curve in decoded["scalarCurves"]:
        sample_counts[curve["storage"]] += len(curve["keys"])

    empty_curves = sum(not curve["keys"] for curve in decoded["scalarCurves"])

    return {
        "name": decoded["name"],
        "duration": decoded["duration"],
        "sampleRate": decoded["sampleRate"],
        "loop": decoded["loop"],
        "wrapMode": decoded["wrapMode"],
        "bindingCount": len(decoded["bindings"]),
        "scalarCurveCount": len(decoded["scalarCurves"]),
        "emptyCurveCount": empty_curves,
        "storageCounts": decoded["storageCounts"],
        "sampleCounts": {
            "streamed": sample_counts["streamed"],
            "dense": sample_counts["dense"],
            "constant": sample_counts["constant"],
        },
        "bindingTypes": [
            {
                "typeId": type_id,
                "count": count,
            }
            for type_id, count in sorted(binding_types.items())
        ],
        "eventCount": len(decoded["events"]),
        "events": decoded["events"],
        "pptrCurveMappingCount": len(decoded["pptrCurveMapping"]),
        "objectReferenceCurveCount": len(decoded["objectReferenceCurves"]),
        "objectReferenceKeyCount": sum(
            len(curve["keys"])
            for curve in decoded["objectReferenceCurves"]
        )
    }


def inspect_animation_clips(environment: Any, bundle_name: str) -> dict:
    clips = []

    for obj in environment.objects:
        if obj.type.name != "AnimationClip":
            continue

        decoded = decode_animation_clip(obj.parse_as_object())
        clips.append(summarize_animation_clip(decoded))

    return {
        "success": True,
        "protocolVersion": 1,
        "bundleName": bundle_name,
        "clips": clips,
    }
