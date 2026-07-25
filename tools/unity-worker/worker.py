from importlib.metadata import version
from pathlib import Path
import traceback
import argparse
import UnityPy
import shutil
import json
import sys
import re

PROTOCOL_VERSION = 1
SUPPORTED_TYPES = {"Texture2D", "TextAsset"}
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_NAMES = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.IGNORECASE)

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
    environment = UnityPy.load(str(bundle_path))
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


def extract_assets(bundle_path: Path, destination: Path, selections: object) -> dict:
    if not isinstance(selections, list) or not selections:
        raise ValueError("At least one asset selection is required.")

    if len(selections) > 10:
        raise ValueError("Too many assets were selected.")

    environment = UnityPy.load(str(bundle_path))
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

        if command == "inspect":
            result = inspect_bundle(bundle_path)
        elif command == "extract":
            destination = require_path(request, "destination", must_exist=False)
            result = extract_assets(bundle_path, destination, request.get("assets"))
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
