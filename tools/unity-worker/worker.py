from animator_runtime_package import prepare_animator_runtime_package
from animation_clip_decoder import inspect_animation_clips
from importlib.metadata import version
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any
from PIL import Image
import traceback
import UnityPy
import shutil
import struct
import json
import math
import sys
import re
import io

PROTOCOL_VERSION = 1
SUPPORTED_TYPES = {"Texture2D", "TextAsset"}
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_NAMES = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.IGNORECASE)
MAX_UNITY_HEADER_STRING = 256
PREVIEW_SUPPORTED_TYPES = {"Texture2D", "Sprite"}
MAX_PREVIEW_SELECTIONS = 64

class BoundedFile(io.BufferedIOBase):
    def __init__(self, file_path: Path, length: int):
        super().__init__()

        self._stream = file_path.open("rb")
        self._length = length
        self.name = str(file_path)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._stream.tell()

    def read(self, size: int | None = -1) -> bytes:
        remaining = self._length - self.tell()

        if remaining <= 0:
            return b""

        if size is None or size < 0:
            size = remaining
        else:
            size = min(size, remaining)

        return self._stream.read(size)

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            target = offset
        elif whence == io.SEEK_CUR:
            target = self.tell() + offset
        elif whence == io.SEEK_END:
            target = self._length + offset
        else:
            raise ValueError("Invalid seek mode.")

        if target < 0:
            raise ValueError("Cannot seek before the beginning of the bundle.")

        self._stream.seek(target, io.SEEK_SET)
        return self.tell()

    def close(self):
        if not self.closed:
            self._stream.close()

        super().close()


def read_exact(stream: Any, size: int) -> bytes:
    data = stream.read(size)

    if len(data) != size:
        raise ValueError("The UnityFS header is truncated.")

    return data


def skip_header_string(stream: Any):
    for _ in range(MAX_UNITY_HEADER_STRING):
        if read_exact(stream, 1) == b"\0":
            return

    raise ValueError("The UnityFS header contains an invalid string.")


def get_unityfs_declared_size(bundle_path: Path) -> int:
    physical_size = bundle_path.stat().st_size

    with bundle_path.open("rb") as bundle:
        if read_exact(bundle, 8) != b"UnityFS\0":
            return physical_size

        read_exact(bundle, 4)

        skip_header_string(bundle)
        skip_header_string(bundle)

        declared_size = struct.unpack(">Q", read_exact(bundle, 8))[0]
        minimum_size = bundle.tell() + 12

    if declared_size < minimum_size:
        raise ValueError("The UnityFS bundle declares an invalid size.")

    if declared_size > physical_size:
        raise ValueError("The UnityFS bundle is truncated.")

    return declared_size


def load_unity_environment(bundle_path: Path):
    physical_size = bundle_path.stat().st_size
    declared_size = get_unityfs_declared_size(bundle_path)

    if declared_size == physical_size:
        return UnityPy.load(str(bundle_path))

    bounded_stream = BoundedFile(bundle_path, declared_size)

    try:
        return UnityPy.load(bounded_stream)
    finally:
        bounded_stream.close()


def create_asset_id(serialized_file: str, path_id: int) -> str:
    return f"{serialized_file}:{path_id}"


def get_catalog_candidates(asset_type: str, name: str) -> list[str]:
    lowered_name = name.lower()

    if asset_type == "Texture2D":
        return [name] if lowered_name.endswith(".png") else [f"{name}.png"]

    if lowered_name.endswith((".json", ".atlas")):
        return [name]

    return [f"{name}.json", f"{name}.atlas"]


def inspect_bundle(bundle_path: Path) -> dict:
    environment = load_unity_environment(bundle_path)
    assets: list[dict] = []

    for obj in environment.objects:
        asset_type = obj.type.name

        if asset_type not in SUPPORTED_TYPES:
            continue

        name = obj.peek_name()
        if not name:
            continue

        serialized_file = obj.assets_file.name

        assets.append({
            "id": create_asset_id(serialized_file, obj.path_id),
            "type": asset_type,
            "name": name,
            "pathId": str(obj.path_id),
            "serializedFile": serialized_file,
            "catalogCandidates": get_catalog_candidates(asset_type, name)
        })

    return {
        "success": True,
        "protocolVersion": PROTOCOL_VERSION,
        "unityPyVersion": version("UnityPy"),
        "bundleName": bundle_path.name,
        "assets": assets
    }


def validate_output_name(output_name: str):
    if (
        not output_name
        or output_name != Path(output_name).name
        or INVALID_FILENAME.search(output_name)
        or output_name.endswith((".", " "))
        or RESERVED_NAMES.match(output_name)
    ):
        raise ValueError(f"Invalid output filename: {output_name}")


def create_untrimmed_sprite_image(sprite: Any, context: str) -> tuple[Image.Image, dict]:
    rect = sprite.m_Rect
    pivot = sprite.m_Pivot
    pixels_per_unit = float(sprite.m_PixelsToUnits)

    values = [
        rect.width,
        rect.height,
        pixels_per_unit,
        getattr(pivot, "x", None),
        getattr(pivot, "y", None)
    ]

    if (
        any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values)
        or rect.width <= 0
        or rect.height <= 0
        or pixels_per_unit <= 0
    ):
        raise ValueError(f"{context} has invalid Sprite geometry.")

    pixel_width = round(rect.width)
    pixel_height = round(rect.height)

    if pixel_width <= 0 or pixel_height <= 0:
        raise ValueError(f"{context} has an invalid Sprite rectangle.")

    cropped_image = sprite.image.convert("RGBA")
    texture_offset = sprite.m_RD.textureRectOffset

    left = round(texture_offset.x)
    top = round(pixel_height - texture_offset.y - cropped_image.height)

    if (
        left < 0
        or top < 0
        or left + cropped_image.width > pixel_width
        or top + cropped_image.height > pixel_height
    ):
        raise ValueError(f"{context} has an invalid packed Sprite offset.")

    image = Image.new("RGBA", (pixel_width, pixel_height), (0, 0, 0, 0))
    image.alpha_composite(cropped_image, (left, top))

    return image, {
        "pixelWidth": pixel_width,
        "pixelHeight": pixel_height,
        "pixelsPerUnit": pixels_per_unit,
        "pivot": {
            "x": float(pivot.x),
            "y": float(pivot.y)
        }
    }


def preview_lookup_names(asset_type: str, asset_name: str) -> set[str]:
    names = {asset_name.casefold()}

    if asset_type == "Texture2D":
        names.update(
            candidate.casefold()
            for candidate in get_catalog_candidates(asset_type, asset_name)
        )

    return names


def extract_preview_assets(bundle_path: Path, destination: Path, selections: object) -> dict:
    if not isinstance(selections, list) or not selections:
        raise ValueError("At least one preview asset selection is required.")

    if len(selections) > MAX_PREVIEW_SELECTIONS:
        raise ValueError("Too many preview assets were selected.")

    environment = load_unity_environment(bundle_path)
    objects_by_key: dict[tuple[str, str], list] = {}

    for obj in environment.objects:
        asset_type = obj.type.name

        if asset_type not in PREVIEW_SUPPORTED_TYPES:
            continue

        asset_name = obj.peek_name()
        if not asset_name:
            continue

        for lookup_name in preview_lookup_names(asset_type, asset_name):
            objects_by_key.setdefault(
                (asset_type, lookup_name),
                []
            ).append(obj)

    validated_selections = []
    selected_assets = set()
    output_names = set()

    for selection in selections:
        if not isinstance(selection, dict):
            raise ValueError("Invalid preview asset selection.")

        asset_type = selection.get("type")
        asset_name = selection.get("name")
        output_name = selection.get("outputName")

        if asset_type not in PREVIEW_SUPPORTED_TYPES:
            raise ValueError("A preview asset selection has an invalid type.")

        if not isinstance(asset_name, str) or not asset_name.strip() or len(asset_name) > 512:
            raise ValueError("A preview asset selection has an invalid name.")
        
        if not isinstance(output_name, str):
            raise ValueError("A preview asset selection has an invalid filename.")

        validate_output_name(output_name)

        if not output_name.casefold().endswith(".png"):
            raise ValueError("Preview assets must be extracted as PNG files.")

        asset_key = (asset_type, asset_name.casefold())

        if asset_key in selected_assets:
            raise ValueError(f"Preview asset selected more than once: {asset_type} {asset_name}")

        output_key = output_name.casefold()

        if output_key in output_names:
            raise ValueError(f"Multiple preview assets target {output_name}.")

        matches = objects_by_key.get(asset_key, [])

        if not matches:
            raise ValueError(f'The {asset_type} asset "{asset_name}" was not found in bundle "{bundle_path.name}".')

        if len(matches) > 1:
            raise ValueError(f'The bundle contains multiple {asset_type} assets named "{asset_name}".')

        selected_assets.add(asset_key)
        output_names.add(output_key)

        validated_selections.append({
            "type": asset_type,
            "name": asset_name,
            "outputName": output_name,
            "object": matches[0]
        })

    destination = destination.resolve()

    if destination.exists():
        raise ValueError("The preview extraction destination already exists.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir()

    written = []

    try:
        for selection in validated_selections:
            obj = selection["object"]
            asset_type = selection["type"]
            asset_name = selection["name"]
            output_name = selection["outputName"]
            target = destination / output_name
            data = obj.parse_as_object()
            sprite_metadata = None

            with target.open("xb") as output:
                if asset_type == "Texture2D":
                    data.image.save(output, format="PNG")
                else:
                    image, sprite_metadata = create_untrimmed_sprite_image(data, f'Sprite "{asset_name}"')
                    image.save(output, format="PNG")

            result = {
                "type": asset_type,
                "name": asset_name,
                "outputName": output_name,
                "size": target.stat().st_size
            }

            if sprite_metadata is not None:
                result["sprite"] = sprite_metadata

            written.append(result)
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise

    return {
        "success": True,
        "protocolVersion": PROTOCOL_VERSION,
        "bundleName": bundle_path.name,
        "written": written
    }


def extract_assets(bundle_path: Path, destination: Path, selections: object) -> dict:
    if not isinstance(selections, list) or not selections:
        raise ValueError("At least one asset selection is required.")

    if len(selections) > 10:
        raise ValueError("Too many assets were selected.")

    environment = load_unity_environment(bundle_path)
    objects_by_id: dict = {}

    for obj in environment.objects:
        if obj.type.name not in SUPPORTED_TYPES:
            continue

        name = obj.peek_name()
        if not name:
            continue

        asset_id = create_asset_id(obj.assets_file.name, obj.path_id)
        objects_by_id[asset_id] = obj

    validated_selections = []
    selected_ids = set()
    output_names = set()

    for selection in selections:
        if not isinstance(selection, dict):
            raise ValueError("Invalid asset selection.")

        asset_id = selection.get("id")
        output_name = selection.get("outputName")

        if not isinstance(asset_id, str):
            raise ValueError("An asset selection has an invalid ID.")
        if not isinstance(output_name, str):
            raise ValueError("An asset selection has an invalid filename.")

        validate_output_name(output_name)

        if asset_id in selected_ids:
            raise ValueError(f"Asset selected more than once: {asset_id}")

        output_key = output_name.casefold()
        if output_key in output_names:
            raise ValueError(f"Multiple assets target {output_name}.")

        obj = objects_by_id.get(asset_id)
        if obj is None:
            raise ValueError(f"The selected asset no longer exists: {asset_id}")

        name = obj.peek_name()
        candidates = get_catalog_candidates(obj.type.name, name)

        if output_key not in { candidate.casefold() for candidate in candidates }:
            raise ValueError(f"{output_name} does not match the selected {obj.type.name} asset.")

        selected_ids.add(asset_id)
        output_names.add(output_key)

        validated_selections.append({
            "id": asset_id,
            "outputName": output_name,
            "object": obj
        })

    destination = destination.resolve()
    if destination.exists():
        raise ValueError("The extraction destination already exists.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir()

    written = []

    try:
        for selection in validated_selections:
            obj = selection["object"]
            output_name = selection["outputName"]
            target = destination / output_name
            data = obj.parse_as_object()

            with target.open("xb") as output:
                if obj.type.name == "Texture2D":
                    data.image.save(output, format="PNG")
                else:
                    output.write(data.m_Script.encode(errors="surrogateescape"))

            written.append({
                "id": selection["id"],
                "outputName": output_name,
                "size": target.stat().st_size
            })
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise

    return {
        "success": True,
        "protocolVersion": PROTOCOL_VERSION,
        "bundleName": bundle_path.name,
        "written": written
    }


def read_request() -> dict:
    request = json.load(sys.stdin)

    if not isinstance(request, dict):
        raise ValueError("The worker request must be an object.")

    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Unsupported worker protocol version.")

    return request


def require_path(request: dict, key: str, *, must_exist: bool) -> Path:
    value = request.get(key)

    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a path.")

    return Path(value).resolve(strict=must_exist)


def main() -> int:
    try:
        request = read_request()
        command = request.get("command")

        bundle_path = require_path(request, "bundlePath", must_exist=True)
        if not bundle_path.is_file():
            raise ValueError("The bundle path is not a file.")

        with redirect_stdout(sys.stderr):
            if command == "inspect":
                result = inspect_bundle(bundle_path)
            elif command == "extract":
                destination = require_path(request, "destination", must_exist=False)
                result = extract_assets(bundle_path, destination, request.get("assets"))
            elif command == "extract-preview":
                destination = require_path(request, "destination", must_exist=False)
                result = extract_preview_assets(bundle_path, destination, request.get("assets"))
            elif command == "inspect-animation-clips":
                environment = load_unity_environment(bundle_path)
                result = inspect_animation_clips(environment, bundle_path.name)
            elif command == "prepare-animator-runtime":
                destination = require_path(request, "destination", must_exist=False)
                environment = load_unity_environment(bundle_path)

                if request.get("unityDefaultResourcesPath") is not None:
                    unity_default_resources_path = require_path(request, "unityDefaultResourcesPath", must_exist=True)

                    if not unity_default_resources_path.is_file():
                        raise ValueError("unityDefaultResourcesPath must be a file.")

                    dependency = environment.load_file(str(unity_default_resources_path), name="unity default resources", is_dependency=True)

                    if dependency is None:
                        raise ValueError("The Unity default resources file could not be loaded.")

                result = prepare_animator_runtime_package(environment, request.get("bundleName"), destination, request.get("locator"))
            else:
                raise ValueError("Unsupported worker command.")

        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))

        return 0
    except Exception as error:
        traceback.print_exc(file=sys.stderr)

        print(json.dumps({
            "success": False,
            "protocolVersion": PROTOCOL_VERSION,
            "message": str(error)
        }, ensure_ascii=False, separators=(",", ":")))

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
