from animator_controller_exporter import export_animator_controllers
from animator_scene_exporter import export_animator_scene
from animation_clip_decoder import decode_animation_clip
from hashlib import sha256
from pathlib import Path
from typing import Any
import shutil
import struct
import json
import math
import re


FORMAT_VERSION = 15

GEOMETRY_FILE_NAME = "geometry.bin"
ANIMATION_FILE_NAME = "animations.bin"
RUNTIME_FILE_NAME = "runtime.json"

GEOMETRY_MAGIC = b"LORGEO1\0"
ANIMATION_MAGIC = b"LORANM1\0"

ANIMATION_KEY = struct.Struct("<ff4fI")
ANIMATION_KEY_SAMPLED = 0
ANIMATION_KEY_CUBIC = 1

SAFE_LOCATOR = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$")

MAXIMUM_CLIPS = 512
MAXIMUM_ANIMATION_KEYS = 50_000_000
MAXIMUM_MANIFEST_SIZE = 32 * 1024 * 1024
MAXIMUM_PACKAGE_FILE_SIZE = 1024 * 1024 * 1024


def require_finite_float(value: Any, context: str) -> float:
    number = float(value)

    if not math.isfinite(number):
        raise ValueError(f"{context} is not finite.")

    return number


def get_file_description(file_path: Path, package_root: Path) -> dict:
    size = file_path.stat().st_size

    if size <= 0 or size > MAXIMUM_PACKAGE_FILE_SIZE:
        raise ValueError(f'"{file_path.relative_to(package_root).as_posix()}" has an invalid size.')

    digest = sha256()

    with file_path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)

    return {
        "path": file_path.relative_to(package_root).as_posix(),
        "size": size,
        "sha256": digest.hexdigest()
    }


def write_animation_data(environment: Any, destination: Path) -> dict:
    target = destination / ANIMATION_FILE_NAME
    clips = []
    total_key_count = 0

    animation_objects = [
        obj for obj in environment.objects
        if obj.type.name == "AnimationClip"
    ]

    if len(animation_objects) > MAXIMUM_CLIPS:
        raise ValueError("The Animator runtime package contains too many animation clips.")

    with target.open("xb") as output:
        output.write(ANIMATION_MAGIC)

        for animation_object in animation_objects:
            clip = decode_animation_clip(animation_object.parse_as_object())
            scalar_curves = []

            for curve in clip["scalarCurves"]:
                first_key = total_key_count
                keys = curve["keys"]

                if total_key_count + len(keys) > MAXIMUM_ANIMATION_KEYS:
                    raise ValueError("The Animator runtime package contains too many animation keys.")

                for key in keys:
                    time = require_finite_float(key["time"], f'AnimationClip "{clip["name"]}" key time')
                    value = require_finite_float(key["value"], f'AnimationClip "{clip["name"]}" key value')

                    raw_coefficients = key.get("coefficients")

                    if raw_coefficients is None:
                        coefficients = (0.0, 0.0, 0.0, 0.0)
                        flags = ANIMATION_KEY_SAMPLED
                    else:
                        if len(raw_coefficients) != 4:
                           raise ValueError(f'AnimationClip "{clip["name"]}" has invalid cubic coefficients.')

                        coefficients = tuple(
                            require_finite_float(coefficient, f'AnimationClip "{clip["name"]}" coefficient')
                            for coefficient in raw_coefficients
                        )
                        flags = ANIMATION_KEY_CUBIC

                    output.write(ANIMATION_KEY.pack(time, value, *coefficients, flags))
                    total_key_count += 1

                scalar_curves.append({
                    "bindingIndex": curve["bindingIndex"],
                    "componentIndex": curve["componentIndex"],
                    "storage": curve["storage"],
                    "firstKey": first_key,
                    "keyCount": len(keys)
                })

            clips.append({
                "pathId": str(animation_object.path_id),
                "name": clip["name"],
                "duration": clip["duration"],
                "sampleRate": clip["sampleRate"],
                "loop": clip["loop"],
                "wrapMode": clip["wrapMode"],
                "bindings": clip["bindings"],
                "scalarCurves": scalar_curves,
                "objectReferenceCurves": clip["objectReferenceCurves"],
                "events": clip["events"],
                "pptrCurveMapping": clip["pptrCurveMapping"]
            })

    return {
        "file": ANIMATION_FILE_NAME,
        "magic": ANIMATION_MAGIC.rstrip(b"\0").decode("ascii"),
        "keyRecordStride": ANIMATION_KEY.size,
        "keyCount": total_key_count,
        "clips": clips
    }


def write_runtime_manifest(
    destination: Path,
    bundle_name: str,
    locator: str,
    scene: dict,
    controllers: list[dict],
    geometry: dict,
    animations: dict,
    textures: list[dict]
):
    manifest = {
        "formatVersion": FORMAT_VERSION,
        "bundleName": bundle_name,
        "locator": locator,
        "scene": scene,
        "controllers": controllers,
        "geometry": geometry,
        "animations": animations,
        "textures": textures
    }

    encoded = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()

    if not encoded or len(encoded) > MAXIMUM_MANIFEST_SIZE:
        raise ValueError("The Animator runtime manifest has an invalid size.")

    with (destination / RUNTIME_FILE_NAME).open("xb") as output:
        output.write(encoded)


def prepare_animator_runtime_package(environment: Any, bundle_name: object, destination: Path, locator: object) -> dict:
    if not isinstance(bundle_name, str) or not SAFE_LOCATOR.fullmatch(bundle_name):
        raise ValueError("The Animator runtime bundle name is invalid.")

    if not isinstance(locator, str) or not SAFE_LOCATOR.fullmatch(locator):
        raise ValueError("The Animator runtime locator is invalid.")

    destination = destination.resolve()

    if destination.exists():
        raise ValueError("The Animator runtime package destination already exists.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir()

    try:
        scene, geometry, textures = export_animator_scene(environment, destination / GEOMETRY_FILE_NAME, destination / "textures", locator)
        animators, controllers = export_animator_controllers(environment, scene)

        scene["animators"] = animators

        animations = write_animation_data(environment, destination)

        write_runtime_manifest(destination, bundle_name, locator, scene, controllers, geometry, animations, textures)

        packaged_files = [
            destination / RUNTIME_FILE_NAME,
            destination / GEOMETRY_FILE_NAME,
            destination / ANIMATION_FILE_NAME,
            *sorted((destination / "textures").glob("*.png"))
        ]

        files = [
            get_file_description(file_path, destination)
            for file_path in packaged_files
        ]

        return {
            "success": True,
            "protocolVersion": 1,
            "bundleName": bundle_name,
            "formatVersion": FORMAT_VERSION,
            "locator": locator,
            "files": files
        }
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
