from UnityPy.helpers.MeshHelper import MeshHandler
from typing import Any, Literal, overload
from hashlib import sha256
from pathlib import Path
from array import array
from io import BytesIO
import math
import sys


GEOMETRY_FILE_NAME = "geometry.bin"
GEOMETRY_MAGIC = b"LORGEO1\0"

MAXIMUM_NODES = 10_000
MAXIMUM_MESHES = 2_000
MAXIMUM_VERTICES_PER_MESH = 2_000_000
MAXIMUM_INDICES_PER_MESH = 12_000_000
MAXIMUM_GEOMETRY_SIZE = 1024 * 1024 * 1024
MAXIMUM_TEXTURES = 512
MAXIMUM_TEXTURE_DIMENSION = 16_384
MAXIMUM_TEXTURE_FILE_SIZE = 128 * 1024 * 1024
MAXIMUM_SPRITES = 4_096
MAXIMUM_PUPPET2D_IK_HANDLES = 256
MAXIMUM_PARTICLE_SYSTEMS = 2_048
MAXIMUM_PUPPET2D_SPLINE_CONTROLS = 256
MAXIMUM_PUPPET2D_SPLINE_POINTS = 4096
UNITY_TEXTURE_WRAP_MODES = {0, 1, 2, 3}

PARTICLE_SYSTEM_MODULE_NAMES = (
    "InitialModule",
    "ShapeModule",
    "EmissionModule",
    "SizeModule",
    "RotationModule",
    "ColorModule",
    "UVModule",
    "VelocityModule",
    "InheritVelocityModule",
    "LifetimeByEmitterSpeedModule",
    "ForceModule",
    "ExternalForcesModule",
    "ClampVelocityModule",
    "NoiseModule",
    "SizeBySpeedModule",
    "RotationBySpeedModule",
    "ColorBySpeedModule",
    "CollisionModule",
    "TriggerModule",
    "SubModule",
    "LightsModule",
    "TrailModule",
    "CustomDataModule"
)

class GeometryWriter:
    COMPONENT_TYPES = {
        "float32": ("f", 4),
        "uint16": ("H", 2),
        "uint32": ("I", 4)
    }

    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.output = file_path.open("xb")
        self.output.write(GEOMETRY_MAGIC)

    def close(self):
        self.output.close()

    def align(self, alignment: int):
        remainder = self.output.tell() % alignment

        if remainder:
            self.output.write(b"\0" * (alignment - remainder))

    def write_array(self, values: Any, component_type: str, components: int) -> dict | None:
        values = list(values)

        if not values:
            return None

        if components <= 0 or len(values) % components:
            raise ValueError("A geometry array has an invalid component count.")

        type_code, item_size = self.COMPONENT_TYPES[component_type]

        if component_type == "float32":
            if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
                raise ValueError("A geometry array contains an invalid float.")
        else:
            maximum = 0xffff if component_type == "uint16" else 0xffffffff

            if any(not isinstance(value, int) or value < 0 or value > maximum for value in values):
                raise ValueError("A geometry array contains an invalid integer.")

        self.align(max(4, item_size))
        byte_offset = self.output.tell()

        data = array(type_code, values)

        if data.itemsize != item_size:
            raise ValueError("The Python runtime uses an unsupported array size.")

        if sys.byteorder != "little":
            data.byteswap()

        data.tofile(self.output)

        byte_length = len(data) * item_size

        if self.output.tell() > MAXIMUM_GEOMETRY_SIZE:
            raise ValueError("The Animator geometry package is too large.")

        return {
            "byteOffset": byte_offset,
            "byteLength": byte_length,
            "count": len(values) // components,
            "componentType": component_type,
            "components": components
        }


def object_id(value: Any) -> str | None:
    path_id = int(value.path_id)

    return str(path_id) if path_id else None


def vector2(value: Any) -> list[float]:
    return [float(value.x), float(value.y)]


def vector3(value: Any) -> list[float]:
    return [float(value.x), float(value.y), float(value.z)]


def quaternion(value: Any) -> list[float]:
    return [
        float(value.x),
        float(value.y),
        float(value.z),
        float(value.w)
    ]


def color(value: Any) -> list[float]:
    return [
        float(value.r),
        float(value.g),
        float(value.b),
        float(value.a)
    ]


def matrix4(value: Any) -> list[float]:
    return [
        float(value.e00), float(value.e01),
        float(value.e02), float(value.e03),
        float(value.e10), float(value.e11),
        float(value.e12), float(value.e13),
        float(value.e20), float(value.e21),
        float(value.e22), float(value.e23),
        float(value.e30), float(value.e31),
        float(value.e32), float(value.e33)
    ]


def flatten_vectors(values: Any, components: int):
    for value in values:
        for component in tuple(value)[:components]:
            yield component


def rectangle(value: Any) -> dict:
    return {
        "x": float(value.x),
        "y": float(value.y),
        "width": float(value.width),
        "height": float(value.height)
    }


def property_pair(value: Any, context: str) -> tuple[Any, Any]:
    if isinstance(value, (tuple, list)) and len(value) == 2:
        first, second = value
    else:
        first = getattr(value, "first", None)
        second = getattr(value, "second", None)

    if first is None or second is None:
        raise ValueError(f"{context} has an invalid property.")

    return first, second


def require_finite_float(value: Any, context: str) -> float:
    result = float(value)

    if not math.isfinite(result):
        raise ValueError(f"{context} is not finite.")

    return result


def has_usable_sprite_uvs(values: Any) -> bool:
    return bool(values) and any(
        float(component) != 0.0
        for value in values
        for component in tuple(value)[:2]
    )


def get_mono_behaviour_class_name(reader: Any) -> str | None:
    behaviour = reader.parse_as_object()
    script_pointer = behaviour.m_Script

    if not script_pointer.path_id:
        return None

    script = script_pointer.deref().parse_as_object()
    class_name = script.m_ClassName

    return class_name if isinstance(class_name, str) and class_name else None


def texture_wrap_mode(texture: Any, axis: str) -> int:
    settings = texture.m_TextureSettings
    mode = getattr(settings, f"m_Wrap{axis}", None)

    if mode is None:
        mode = getattr(settings, "m_WrapMode", None)

    if mode is None:
        mode = 0

    mode = int(mode)

    if mode not in UNITY_TEXTURE_WRAP_MODES:
        raise ValueError(f'Texture2D "{texture.m_Name}" has an invalid {axis} wrap mode.')

    return mode


def normalize_skinning(handler: MeshHandler) -> tuple[list[int], list[float]]:
    vertex_count = handler.m_VertexCount
    raw_indices = handler.m_BoneIndices or []
    raw_weights = handler.m_BoneWeights or []

    indices: list[int] = []
    weights: list[float] = []

    for vertex_index in range(vertex_count):
        source_indices = (
            tuple(raw_indices[vertex_index])
            if vertex_index < len(raw_indices)
            else ()
        )
        source_weights = (
            tuple(raw_weights[vertex_index])
            if vertex_index < len(raw_weights)
            else ()
        )

        if len(source_indices) > 4 or len(source_weights) > 4:
            raise ValueError("A mesh vertex has too many bone influences.")

        padded_indices = list(source_indices) + [0] * (4 - len(source_indices))

        if source_weights:
            padded_weights = (
                list(source_weights) +
                [0.0] * (4 - len(source_weights))
            )
        elif source_indices:
            padded_weights = [1.0, 0.0, 0.0, 0.0]
        else:
            padded_weights = [0.0, 0.0, 0.0, 0.0]

        indices.extend(int(value) for value in padded_indices)
        weights.extend(float(value) for value in padded_weights)

    return indices, weights


def derive_sprite_uvs(sprite: Any, render_data: Any, vertices: list[Any], texture_size: tuple[int, int]) -> list[float]:
    texture_width, texture_height = texture_size

    if texture_width <= 0 or texture_height <= 0:
        raise ValueError(f'Sprite "{sprite.m_Name}" has invalid texture dimensions.')

    uv_transform = getattr(render_data, "uvTransform", None)

    if uv_transform is not None:
        scale_x = require_finite_float(uv_transform.x, f'Sprite "{sprite.m_Name}" UV scale X')
        offset_x = require_finite_float(uv_transform.y, f'Sprite "{sprite.m_Name}" UV offset X')
        scale_y = require_finite_float(uv_transform.z, f'Sprite "{sprite.m_Name}" UV scale Y')
        offset_y = require_finite_float(uv_transform.w, f'Sprite "{sprite.m_Name}" UV offset Y')
    else:
        pixels_per_unit = require_finite_float(sprite.m_PixelsToUnits, f'Sprite "{sprite.m_Name}" pixels per unit')

        scale_x = pixels_per_unit
        scale_y = pixels_per_unit
        offset_x = float(sprite.m_Rect.width) * float(sprite.m_Pivot.x) + float(render_data.textureRect.x) - float(render_data.textureRectOffset.x)
        offset_y = float(sprite.m_Rect.height) * float(sprite.m_Pivot.y) + float(render_data.textureRect.y) - float(render_data.textureRectOffset.y)

    result: list[float] = []

    for vertex in vertices:
        components = tuple(vertex)

        if len(components) < 2:
            raise ValueError(f'Sprite "{sprite.m_Name}" has an invalid mesh vertex.')

        x = require_finite_float(components[0], f'Sprite "{sprite.m_Name}" vertex X')
        y = require_finite_float(components[1], f'Sprite "{sprite.m_Name}" vertex Y')

        result.extend((
            (x * scale_x + offset_x) / texture_width,
            (y * scale_y + offset_y) / texture_height
        ))

    return result


def resolve_shader_name(shader_pointer: Any) -> str | None:
    if not shader_pointer.path_id:
        return None

    try:
        shader = shader_pointer.deref().parse_as_object()
    except FileNotFoundError:
        return None

    parsed_form = getattr(shader, "m_ParsedForm", None)

    for value in (getattr(parsed_form, "m_Name", None), getattr(shader, "m_Name", None)):
        if isinstance(value, str) and value:
            return value

    return None


def resolve_material_blend_mode(float_properties: list[dict], shader_name: str | None) -> Literal["normal", "add", "multiply"]:
    values = {
        str(property_value["name"]): float(property_value["value"])
        for property_value in float_properties
    }

    explicit_mode = values.get("_BlendMode")
    source = values.get("_Src", values.get("_SrcBlend"))
    destination = values.get("_Dst", values.get("_DstBlend"))
    normalized_shader = (shader_name or "").casefold()

    if explicit_mode == 1.0 or (source == 1.0 and destination == 1.0) or "particles/additive" in normalized_shader:
        return "add"

    if source == 2.0 and destination == 10.0:
        return "multiply"

    return "normal"


def export_blend_shapes(mesh: Any, writer: GeometryWriter) -> list[dict]:
    shape_data = mesh.m_Shapes

    if not shape_data or not shape_data.channels:
        return []

    channels = []
    shapes = shape_data.shapes or []
    vertices = shape_data.vertices or []
    full_weights = shape_data.fullWeights or []

    for channel in shape_data.channels:
        frames = []

        for frame_offset in range(int(channel.frameCount)):
            shape_index = int(channel.frameIndex) + frame_offset

            if shape_index < 0 or shape_index >= len(shapes):
                raise ValueError(f'Mesh "{mesh.m_Name}" has an invalid blend-shape frame.')

            shape = shapes[shape_index]
            first_vertex = int(shape.firstVertex)
            vertex_count = int(shape.vertexCount)
            last_vertex = first_vertex + vertex_count

            if first_vertex < 0 or vertex_count < 0 or last_vertex > len(vertices):
                raise ValueError(f'Mesh "{mesh.m_Name}" has invalid blend-shape vertices.')

            frame_vertices = vertices[first_vertex:last_vertex]
            indices = writer.write_array((int(vertex.index) for vertex in frame_vertices), "uint32", 1)
            positions = writer.write_array((component for vertex in frame_vertices for component in vector3(vertex.vertex)), "float32", 3)
            normals = None

            if bool(shape.hasNormals):
                normals = writer.write_array((component for vertex in frame_vertices for component in vector3(vertex.normal)), "float32", 3)

            tangents = None

            if bool(shape.hasTangents):
                tangents = writer.write_array((component for vertex in frame_vertices for component in vector3(vertex.tangent)), "float32", 3)

            weight = float(full_weights[shape_index]) if shape_index < len(full_weights) else 100.0

            frames.append({
                "weight": weight,
                "indices": indices,
                "positions": positions,
                "normals": normals,
                "tangents": tangents
            })

        channels.append({
            "name": channel.name,
            "nameHash": int(channel.nameHash),
            "frames": frames
        })

    return channels


def export_mesh(mesh_reader: Any, writer: GeometryWriter) -> dict:
    mesh = mesh_reader.parse_as_object()
    handler = MeshHandler(mesh)
    handler.process()

    vertex_count = int(handler.m_VertexCount)
    indices = list(handler.m_IndexBuffer or [])

    if vertex_count <= 0 or vertex_count > MAXIMUM_VERTICES_PER_MESH:
        raise ValueError(f'Mesh "{mesh.m_Name}" has an invalid vertex count.')

    if not handler.m_Vertices or len(handler.m_Vertices) != vertex_count:
        raise ValueError(f'Mesh "{mesh.m_Name}" has no valid positions.')

    if len(indices) > MAXIMUM_INDICES_PER_MESH:
        raise ValueError(f'Mesh "{mesh.m_Name}" has too many indices.')

    positions = writer.write_array(flatten_vectors(handler.m_Vertices, 3), "float32", 3)
    normals = None

    if handler.m_Normals:
        if len(handler.m_Normals) != vertex_count:
            raise ValueError(f'Mesh "{mesh.m_Name}" has invalid normals.')

        normals = writer.write_array(flatten_vectors(handler.m_Normals, 3), "float32", 3)

    uv0 = None

    if handler.m_UV0:
        if len(handler.m_UV0) != vertex_count:
            raise ValueError(f'Mesh "{mesh.m_Name}" has invalid UVs.')

        uv0 = writer.write_array(flatten_vectors(handler.m_UV0, 2), "float32", 2)

    bone_indices, bone_weights = normalize_skinning(handler)
    skin_indices = writer.write_array(bone_indices, "uint16", 4)
    skin_weights = writer.write_array(bone_weights, "float32", 4)
    index_view = writer.write_array((int(index) for index in indices), "uint32", 1)
    bind_poses = writer.write_array((component for bind_pose in (mesh.m_BindPose or []) for component in matrix4(bind_pose)), "float32", 16)
    source_index_size = 2 if handler.m_Use16BitIndices else 4
    submeshes = []

    for material_slot, submesh in enumerate(mesh.m_SubMeshes or []):
        first_byte = int(submesh.firstByte)

        if first_byte < 0 or first_byte % source_index_size:
            raise ValueError(f'Mesh "{mesh.m_Name}" has an invalid submesh.')

        index_start = first_byte // source_index_size
        index_count = int(submesh.indexCount)

        if index_start < 0 or index_count < 0 or index_start + index_count > len(indices):
            raise ValueError(f'Mesh "{mesh.m_Name}" has an invalid submesh range.')

        submeshes.append({
            "materialSlot": material_slot,
            "indexStart": index_start,
            "indexCount": index_count,
            "baseVertex": int(submesh.baseVertex or 0),
            "topology": int(submesh.topology)
        })

    return {
        "id": str(mesh_reader.path_id),
        "name": mesh.m_Name,
        "vertexCount": vertex_count,
        "positions": positions,
        "normals": normals,
        "uv0": uv0,
        "boneIndices": skin_indices,
        "boneWeights": skin_weights,
        "indices": index_view,
        "bindPoses": bind_poses,
        "submeshes": submeshes,
        "blendShapes": export_blend_shapes(mesh, writer)
    }


def export_texture(texture_reader: Any, texture_directory: Path) -> dict:
    texture = texture_reader.parse_as_object()
    image = texture.image

    width, height = image.size

    if width <= 0 or height <= 0 or width > MAXIMUM_TEXTURE_DIMENSION or height > MAXIMUM_TEXTURE_DIMENSION:
        raise ValueError(f'Texture2D "{texture.m_Name}" has invalid dimensions.')

    encoded = BytesIO()
    image.save(encoded, format="PNG")
    contents = encoded.getvalue()

    if not contents or len(contents) > MAXIMUM_TEXTURE_FILE_SIZE:
        raise ValueError(f'Texture2D "{texture.m_Name}" has an invalid encoded size.')

    digest = sha256(contents).hexdigest()
    relative_path = f"textures/{digest}.png"
    target = texture_directory / f"{digest}.png"

    texture_directory.mkdir(parents=True, exist_ok=True)

    if not target.exists():
        with target.open("xb") as output:
            output.write(contents)

    asset_name = (
        texture.m_Name
        if texture.m_Name.casefold().endswith(".png")
        else f"{texture.m_Name}.png"
    )

    wrap_mode_u = texture_wrap_mode(texture, "U")
    wrap_mode_v = texture_wrap_mode(texture, "V")

    return {
        "id": str(texture_reader.path_id),
        "name": texture.m_Name,
        "assetName": asset_name,
        "file": relative_path,
        "sha256": digest,
        "width": width,
        "height": height,
        "wrapModeU": wrap_mode_u,
        "wrapModeV": wrap_mode_v
    }


def export_material(material_reader: Any) -> dict:
    material = material_reader.parse_as_object()
    properties = material.m_SavedProperties

    texture_properties = []

    for raw_property in properties.m_TexEnvs or []:
        name, texture_environment = property_pair(raw_property, f'Material "{material.m_Name}" texture property')

        texture_properties.append({
            "name": str(name),
            "textureId": object_id(texture_environment.m_Texture),
            "scale": vector2(texture_environment.m_Scale),
            "offset": vector2(texture_environment.m_Offset)
        })

    float_properties = []

    for raw_property in properties.m_Floats or []:
        name, value = property_pair(raw_property, f'Material "{material.m_Name}" float property')

        float_properties.append({
            "name": str(name),
            "value": require_finite_float(value, f'Material "{material.m_Name}" property "{name}"')
        })

    int_properties = []

    for raw_property in properties.m_Ints or []:
        name, value = property_pair(raw_property, f'Material "{material.m_Name}" integer property')

        int_properties.append({
            "name": str(name),
            "value": int(value)
        })

    color_properties = []

    for raw_property in properties.m_Colors or []:
        name, value = property_pair(raw_property, f'Material "{material.m_Name}" color property')

        color_properties.append({
            "name": str(name),
            "value": color(value)
        })

    shader_name = resolve_shader_name(material.m_Shader)

    return {
        "id": str(material_reader.path_id),
        "name": material.m_Name,
        "shaderId": object_id(material.m_Shader),
        "shaderName": shader_name,
        "renderQueue": int(material.m_CustomRenderQueue),
        "textureProperties": texture_properties,
        "floatProperties": float_properties,
        "intProperties": int_properties,
        "colorProperties": color_properties,
        "blendMode": resolve_material_blend_mode(float_properties, shader_name),
    }


def export_sprite(sprite_reader: Any, writer: GeometryWriter, texture_sizes_by_id: dict[str, tuple[int, int]]) -> dict:
    sprite = sprite_reader.parse_as_object()
    render_data = sprite.m_RD

    handler = MeshHandler(render_data, sprite.object_reader.version)
    handler.process()

    vertices = list(handler.m_Vertices or [])
    positions = None

    if vertices:
        positions = writer.write_array(flatten_vectors(vertices, 2), "float32", 2)

    uv0 = None

    if handler.m_UV0 and has_usable_sprite_uvs(handler.m_UV0):
        if len(handler.m_UV0) != len(vertices):
            raise ValueError( f'Sprite "{sprite.m_Name}" has mismatched vertex and UV counts.')

        uv_values = list(flatten_vectors(handler.m_UV0, 2))
    elif vertices:
        texture_id = object_id(render_data.texture)

        if not texture_id:
            raise ValueError(f'Sprite "{sprite.m_Name}" has no texture.')

        texture_size = texture_sizes_by_id.get(texture_id)

        if not texture_size:
            raise ValueError(f'Sprite "{sprite.m_Name}" references unavailable texture "{texture_id}".')

        uv_values = derive_sprite_uvs(sprite, render_data, vertices, texture_size)
    else:
        uv_values = []

    if uv_values:
        uv0 = writer.write_array(uv_values, "float32", 2)

    indices = None

    if handler.m_IndexBuffer:
        indices = writer.write_array((int(index) for index in handler.m_IndexBuffer), "uint32", 1)

    pixels_per_unit = require_finite_float(sprite.m_PixelsToUnits, f'Sprite "{sprite.m_Name}" pixels per unit')

    if pixels_per_unit <= 0:
        raise ValueError(f'Sprite "{sprite.m_Name}" has invalid pixels per unit.')

    return {
        "id": str(sprite_reader.path_id),
        "name": sprite.m_Name,
        "textureId": object_id(render_data.texture),
        "alphaTextureId": object_id(render_data.alphaTexture),
        "rect": rectangle(sprite.m_Rect),
        "textureRect": rectangle(render_data.textureRect),
        "textureRectOffset": vector2(render_data.textureRectOffset),
        "pivot": vector2(sprite.m_Pivot),
        "pixelsPerUnit": pixels_per_unit,
        "packingSettings": int(render_data.settingsRaw),
        "mesh": {
            "positions": positions,
            "uv0": uv0,
            "indices": indices
        } if positions and indices else None
    }


def find_root_transform(environment: Any, locator: str):
    objects_by_id = {
        int(obj.path_id): obj
        for obj in environment.objects
    }

    actor_game_objects = []

    for reader in environment.objects:
        if reader.type.name != "MonoBehaviour":
            continue

        try:
            tree = reader.read_typetree()
        except Exception:
            continue

        if not isinstance(tree, dict) or "_faceNameList" not in tree or "_specialTouch" not in tree:
            continue

        game_object_id = typetree_object_id(tree.get("m_GameObject"), "Animator Actor GameObject", required=True)
        game_object_reader = objects_by_id.get(int(game_object_id))

        if game_object_reader is None or game_object_reader.type.name != "GameObject":
            raise ValueError("The Animator Actor references an invalid GameObject.")

        if game_object_reader.peek_name().casefold() == locator.casefold():
            actor_game_objects.append(game_object_reader)

    if len(actor_game_objects) != 1:
        raise ValueError(f'The Animator Actor root "{locator}" could not be resolved uniquely.')

    root_game_object_reader = actor_game_objects[0]
    game_object = root_game_object_reader.parse_as_object()

    transforms = [
        component.component
        for component in game_object.m_Component
        if component.component.path_id and component.component.deref().type.name == "Transform"
    ]

    if len(transforms) != 1:
        raise ValueError(f'The Animator root GameObject "{locator}" has an invalid Transform.')

    return root_game_object_reader, transforms[0].deref()


def collect_hierarchy(environment: Any, locator: str):
    root_game_object_reader, root_transform_reader = find_root_transform(environment, locator)

    transforms = []
    game_object_readers = {}
    component_readers = {}
    visited = set()
    stack: list[tuple[Any, str | None, str]] = [(root_transform_reader, None, "")]

    while stack:
        transform_reader, parent_id, relative_path = stack.pop()
        transform_id = int(transform_reader.path_id)

        if transform_id in visited:
            raise ValueError("The Animator hierarchy contains a Transform cycle.")

        visited.add(transform_id)

        if len(visited) > MAXIMUM_NODES:
            raise ValueError("The Animator hierarchy contains too many objects.")

        transform = transform_reader.parse_as_object()
        game_object_reader = transform.m_GameObject.deref()
        game_object = game_object_reader.parse_as_object()
        game_object_id = str(game_object_reader.path_id)

        game_object_readers[int(game_object_reader.path_id)] = game_object_reader

        children = [
            child.deref()
            for child in transform.m_Children
            if child.path_id
        ]

        transforms.append({
            "id": str(transform_id),
            "gameObjectId": game_object_id,
            "parentId": parent_id,
            "relativePath": relative_path,
            "localPosition": vector3(transform.m_LocalPosition),
            "localRotation": quaternion(transform.m_LocalRotation),
            "localScale": vector3(transform.m_LocalScale),
            "children": [str(child.path_id) for child in children]
        })

        for component in game_object.m_Component:
            pointer = component.component

            if pointer.path_id:
                component_readers[int(pointer.path_id)] = pointer.deref()

        for child_reader in reversed(children):
            child_transform = child_reader.parse_as_object()
            child_name = child_transform.m_GameObject.deref().peek_name()

            child_path = (
                child_name
                if not relative_path
                else f"{relative_path}/{child_name}"
            )

            stack.append((
                child_reader,
                str(transform_id),
                child_path
            ))

    game_objects = []

    for reader in game_object_readers.values():
        game_object = reader.parse_as_object()

        components = []

        for component in game_object.m_Component:
            pointer = component.component

            if not pointer.path_id:
                continue

            component_reader = pointer.deref()

            components.append({
                "id": str(component_reader.path_id),
                "type": component_reader.type.name
            })

        game_objects.append({
            "id": str(reader.path_id),
            "name": game_object.m_Name,
            "active": bool(game_object.m_IsActive),
            "layer": int(game_object.m_Layer),
            "components": components
        })

    return {
        "rootGameObjectId": str(root_game_object_reader.path_id),
        "transforms": transforms,
        "gameObjects": game_objects,
        "componentReaders": component_readers
    }


@overload
def typetree_object_id(value: object, context: str, *, required: Literal[True]) -> str:
    ...

@overload
def typetree_object_id(value: object, context: str, *, required: Literal[False] = False) -> str | None:
    ...

def typetree_object_id(value: object, context: str, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise ValueError(f"{context} is missing.")
        return None

    if not isinstance(value, dict):
        raise ValueError(f"{context} has an invalid reference.")

    file_id = int(value.get("m_FileID", 0))
    path_id = int(value.get("m_PathID", 0))

    if path_id == 0:
        if required:
            raise ValueError(f"{context} is missing.")
        return None

    if file_id != 0:
        raise ValueError(f"{context} uses an unsupported external reference.")

    return str(path_id)


def typetree_object_ids(value: object, context: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{context} is not a list.")

    result = []

    for index, item in enumerate(value):
        result.append(typetree_object_id(
            item,
            f"{context} entry {index}",
            required=True
        ))

    return result


def typetree_vector(value: object, components: tuple[str, ...], context: str) -> list[float]:
    if not isinstance(value, dict):
        raise ValueError(f"{context} is invalid.")

    return [
        require_finite_float(value.get(component), f"{context}.{component}")
        for component in components
    ]


def require_reference_type(reference_id: str | None, object_types: dict[str, str], expected_types: str | tuple[str, ...], context: str):
    if reference_id is None:
        return

    expected = (
        (expected_types,)
        if isinstance(expected_types, str)
        else expected_types
    )
    actual = object_types.get(reference_id)

    if actual not in expected:
        raise ValueError(f'{context} references "{actual or "missing"}" instead of {" or ".join(expected)}.')


def get_components_of_type(components_by_game_object: dict[str, list[dict]], game_object_id: str, component_types: str | tuple[str, ...]) -> list[str]:
    expected = (
        (component_types,)
        if isinstance(component_types, str)
        else component_types
    )

    return [
        component["id"]
        for component in components_by_game_object.get(game_object_id, [])
        if component["type"] in expected
    ]


def export_animator_hitbox(
    game_object_id: str,
    context: str,
    components_by_game_object: dict[str, list[dict]],
    component_readers: dict[int, Any],
    *,
    required: bool
) -> dict | None:
    candidates = get_components_of_type(components_by_game_object, game_object_id, ("BoxCollider", "BoxCollider2D"))

    if not candidates:
        if required:
            raise ValueError(f"{context} has no supported collider.")
        return None

    if len(candidates) != 1:
        raise ValueError(f"{context} does not have exactly one collider.")

    component_id = candidates[0]
    reader = component_readers[int(component_id)]
    tree = reader.read_typetree()
    collider_type = reader.type.name

    if collider_type == "BoxCollider":
        center = typetree_vector(tree.get("m_Center"), ("x", "y", "z"), f"{context} center")
        size = typetree_vector(tree.get("m_Size"), ("x", "y", "z"), f"{context} size")
    else:
        center = typetree_vector(tree.get("m_Offset"), ("x", "y"), f"{context} offset")
        size = typetree_vector(tree.get("m_Size"), ("x", "y"), f"{context} size")

    if any(component < 0 for component in size) or sum(component > 0 for component in size) < 2:
        raise ValueError(f"{context} has an invalid size.")

    return {
        "id": component_id,
        "type": collider_type,
        "gameObjectId": game_object_id,
        "enabled": bool(tree.get("m_Enabled", True)),
        "center": center,
        "size": size
    }


def export_part_transform_change(
    change_info: dict,
    pointer_name: str,
    position_name: str,
    scale_name: str,
    context: str,
    object_types: dict[str, str],
    transforms_by_id: dict[str, dict]
) -> dict | None:
    transform_id = typetree_object_id(change_info.get(pointer_name), f"{context} transform")

    if transform_id is None:
        return None

    require_reference_type(transform_id, object_types, "Transform", f"{context} transform")

    transform = transforms_by_id.get(transform_id)

    if transform is None:
        raise ValueError(f"{context} transform is outside the Animator hierarchy.")

    return {
        "transformId": transform_id,
        "onPosition": transform["localPosition"],
        "onScale": transform["localScale"],
        "offPosition": typetree_vector(change_info.get(position_name), ("x", "y", "z"), f"{context} off position"),
        "offScale": typetree_vector(change_info.get(scale_name), ("x", "y", "z"), f"{context} off scale")
    }


def export_parts_view(
    component_id: str,
    tree: dict,
    game_object_ids: set[str],
    object_types: dict[str, str],
    transforms_by_id: dict[str, dict]
) -> dict:
    def game_object_list(field: str) -> list[str]:
        references = typetree_object_ids(tree.get(field), f'ActorPartsView "{component_id}" {field}')

        for reference in references:
            require_reference_type(reference, object_types, "GameObject", f'ActorPartsView "{component_id}" {field}')

            if reference not in game_object_ids:
                raise ValueError(f'ActorPartsView "{component_id}" references an object outside the Animator hierarchy.')

        return references

    is_swap = bool(tree.get("_isSwapParts", False))

    if is_swap:
        part1_enabled = game_object_list("_listSwapActiveObject")
        part1_disabled = game_object_list("_listSwapDeactiveObject")
    else:
        part1_enabled = game_object_list("_listParts")
        part1_disabled = []

    part2 = game_object_list("_listParts2")
    backgrounds = game_object_list("_listBg")
    dialog_deactivated = game_object_list("_listDialogDeactiveParts")

    transform_changes = []

    if bool(tree.get("_useChangeInfo", False)) and backgrounds:
        off_info = tree.get("_offInfo")

        if not isinstance(off_info, dict):
            raise ValueError(f'ActorPartsView "{component_id}" has invalid change information.')

        for change in (
            export_part_transform_change(
                off_info,
                "SpTouch",
                "SpTouchPos",
                "SpTouchScale",
                f'ActorPartsView "{component_id}" special-touch',
                object_types,
                transforms_by_id
            ),
            export_part_transform_change(
                off_info,
                "Root",
                "RootPos",
                "RootScale",
                f'ActorPartsView "{component_id}" root',
                object_types,
                transforms_by_id
            )
        ):
            if change is not None:
                transform_changes.append(change)

    return {
        "componentId": component_id,
        "part1": {
            "defaultEnabled": bool(tree.get("isDefaultOn", True)),
            "enableObjectIds": part1_enabled,
            "disableObjectIds": part1_disabled
        },
        "part2": {
            "defaultEnabled": bool(tree.get("isDefaultOnPart2", True)),
            "enableObjectIds": part2,
            "disableObjectIds": []
        },
        "background": {
            "defaultEnabled": False,
            "enableObjectIds": backgrounds,
            "disableObjectIds": [],
            "transformChanges": transform_changes
        },
        "dialogDeactivatedObjectIds": dialog_deactivated
    }


def export_material_rplus_switcher(
    component_id: str,
    tree: dict,
    object_types: dict[str, str],
    component_readers: dict[int, Any]
) -> dict:
    raw_variants = tree.get("_materialVariants")
    raw_uses = tree.get("_rendererUses")

    if not isinstance(raw_variants, list) or not isinstance(raw_uses, list):
        raise ValueError(f'RPlus material switcher "{component_id}" has invalid lists.')

    variants: dict[str, dict] = {}

    for index, variant in enumerate(raw_variants):
        if not isinstance(variant, dict):
            raise ValueError(f'RPlus material switcher "{component_id}" variant {index} is invalid.')

        material_id = typetree_object_id(variant.get("material"), f'RPlus material switcher "{component_id}" variant material', required=True)
        origin_texture_id = typetree_object_id(variant.get("originTexture"), f'RPlus material switcher "{component_id}" origin texture')
        rplus_texture_id = typetree_object_id(variant.get("rplusTexture"), f'RPlus material switcher "{component_id}" RPlus texture')
        property_name = variant.get("texturePropertyName")

        if not isinstance(property_name, str) or not property_name:
            raise ValueError(f'RPlus material switcher "{component_id}" has an invalid property.')

        require_reference_type(material_id, object_types, "Material", "RPlus material")
        require_reference_type(origin_texture_id, object_types, "Texture2D", "RPlus origin texture")
        require_reference_type(rplus_texture_id, object_types, "Texture2D", "RPlus replacement texture")

        if material_id in variants:
            raise ValueError(f'RPlus material switcher "{component_id}" has duplicate materials.')

        variants[material_id] = {
            "texturePropertyName": property_name,
            "originTextureId": origin_texture_id,
            "rplusTextureId": rplus_texture_id
        }

    bindings = []

    for index, renderer_use in enumerate(raw_uses):
        if not isinstance(renderer_use, dict):
            raise ValueError(f'RPlus material switcher "{component_id}" use {index} is invalid.')

        renderer_id = typetree_object_id(renderer_use.get("renderer"), f'RPlus material switcher "{component_id}" renderer', required=True)
        material_id = typetree_object_id(renderer_use.get("material"), f'RPlus material switcher "{component_id}" material', required=True)
        material_index = int(renderer_use.get("materialIndex", -1))
        variant = variants.get(material_id)

        require_reference_type(renderer_id, object_types, "SkinnedMeshRenderer", "RPlus renderer")

        if variant is None:
            raise ValueError(f'RPlus material switcher "{component_id}" use has no variant.')

        renderer = component_readers[int(renderer_id)].parse_as_object()

        if material_index < 0 or material_index >= len(renderer.m_Materials):
            raise ValueError(f'RPlus material switcher "{component_id}" has an invalid material slot.')

        slot_material_id = object_id(renderer.m_Materials[material_index])

        if slot_material_id != material_id:
            raise ValueError(f'RPlus material switcher "{component_id}" material slot does not match.')

        bindings.append({
            "rendererId": renderer_id,
            "materialIndex": material_index,
            "materialId": material_id,
            **variant
        })

    return {
        "componentId": component_id,
        "bindings": bindings
    }


def export_sprite_rplus_switcher(
    component_id: str,
    tree: dict,
    object_types: dict[str, str]
) -> dict:
    raw_captures = tree.get("_CapturedSprite")

    if not isinstance(raw_captures, list):
        raise ValueError(f'RPlus sprite switcher "{component_id}" has an invalid capture list.')

    bindings = []

    for index, capture in enumerate(raw_captures):
        if not isinstance(capture, dict):
            raise ValueError(f'RPlus sprite switcher "{component_id}" capture {index} is invalid.')

        renderer_id = typetree_object_id(capture.get("_rederer"), f'RPlus sprite switcher "{component_id}" renderer', required=True)
        origin_sprite_id = typetree_object_id(capture.get("_spriteOrigin"), f'RPlus sprite switcher "{component_id}" origin sprite')
        rplus_sprite_id = typetree_object_id(capture.get("_spriteRplus"),  f'RPlus sprite switcher "{component_id}" RPlus sprite')

        require_reference_type(renderer_id, object_types, "SpriteRenderer", "RPlus sprite renderer")
        require_reference_type(origin_sprite_id, object_types, "Sprite", "RPlus origin sprite")
        require_reference_type(rplus_sprite_id, object_types, "Sprite", "RPlus replacement sprite")

        bindings.append({
            "rendererId": renderer_id,
            "originSpriteId": origin_sprite_id,
            "rplusSpriteId": rplus_sprite_id
        })

    return {
        "componentId": component_id,
        "bindings": bindings
    }


def export_mosaic(
    component_id: str,
    tree: dict,
    object_types: dict[str, str],
    components_by_game_object: dict[str, list[dict]]
) -> dict:
    game_object_id = typetree_object_id(tree.get("m_GameObject"), f'MosaicOverlay "{component_id}" GameObject', required=True)
    renderer_id = typetree_object_id(tree.get("targetRenderer"), f'MosaicOverlay "{component_id}" target renderer')

    if renderer_id is None:
        renderers = get_components_of_type(components_by_game_object, game_object_id, "SpriteRenderer")

        if len(renderers) != 1:
            raise ValueError(f'MosaicOverlay "{component_id}" cannot resolve its SpriteRenderer.')

        renderer_id = renderers[0]

    require_reference_type(renderer_id, object_types, "SpriteRenderer", f'MosaicOverlay "{component_id}" target renderer')

    reference_size = require_finite_float(tree.get("referenceScreenSize", 300), f'MosaicOverlay "{component_id}" reference size')
    minimum = require_finite_float(tree.get("minMultiplier", 0.25), f'MosaicOverlay "{component_id}" minimum multiplier')
    maximum = require_finite_float(tree.get("maxMultiplier", 4), f'MosaicOverlay "{component_id}" maximum multiplier')

    if reference_size <= 0 or minimum <= 0 or maximum < minimum:
        raise ValueError(f'MosaicOverlay "{component_id}" has invalid scale limits.')

    return {
        "componentId": component_id,
        "gameObjectId": game_object_id,
        "rendererId": renderer_id,
        "enabled": bool(tree.get("m_Enabled", True)),
        "referenceScreenSize": reference_size,
        "minMultiplier": minimum,
        "maxMultiplier": maximum
    }


def export_animator_interactions(environment: Any, hierarchy: dict, component_readers: dict[int, Any]) -> dict:
    object_types = {
        str(obj.path_id): obj.type.name
        for obj in environment.objects
    }
    game_objects = {
        game_object["id"]: game_object
        for game_object in hierarchy["gameObjects"]
    }
    transforms_by_id = {
        transform["id"]: transform
        for transform in hierarchy["transforms"]
    }
    components_by_game_object = {
        game_object_id: game_object["components"]
        for game_object_id, game_object in game_objects.items()
    }

    mono_behaviours: list[tuple[str, dict]] = []

    for reader in component_readers.values():
        if reader.type.name != "MonoBehaviour":
            continue

        try:
            tree = reader.read_typetree()
        except Exception:
            continue

        if isinstance(tree, dict):
            mono_behaviours.append((str(reader.path_id), tree))

    actors = [
        entry
        for entry in mono_behaviours
        if "_faceNameList" in entry[1] and "_specialTouch" in entry[1]
    ]

    if len(actors) != 1:
        raise ValueError("The Animator runtime does not contain exactly one Actor component.")

    actor_component_id, actor_tree = actors[0]
    actor_game_object_id = typetree_object_id(actor_tree.get("m_GameObject"), "Animator Actor GameObject", required=True)

    if actor_game_object_id not in game_objects:
        raise ValueError("The Animator Actor is outside the exported hierarchy.")

    face_names = actor_tree.get("_faceNameList")

    if not isinstance(face_names, list) or not all(isinstance(name, str) and name for name in face_names):
        raise ValueError("The Animator Actor has an invalid face-name list.")

    face_renderer_id = typetree_object_id(actor_tree.get("spriteFace"), "Animator face renderer")

    if face_renderer_id is None:
        for transform in hierarchy["transforms"]:
            game_object = game_objects[transform["gameObjectId"]]

            if game_object["name"] != "face":
                continue

            renderers = get_components_of_type(components_by_game_object, game_object["id"], "SpriteRenderer")

            if renderers:
                face_renderer_id = renderers[0]
                break

    require_reference_type(face_renderer_id, object_types, "SpriteRenderer", "Animator face renderer")

    touch_hitbox = export_animator_hitbox(actor_game_object_id, "Animator touch region", components_by_game_object, component_readers, required=False)
    special_touch_game_object_ids = []

    for field_name in ("_specialTouch", "_specialTouch2"):
        reference = typetree_object_id(actor_tree.get(field_name), f"Animator Actor {field_name}")

        if reference is None:
            continue

        require_reference_type(reference, object_types, "GameObject", f"Animator Actor {field_name}")

        if reference not in game_objects:
            raise ValueError(f"Animator Actor {field_name} is outside the exported hierarchy.")

        if reference not in special_touch_game_object_ids:
            special_touch_game_object_ids.append(reference)

    special_hitboxes = [
        export_animator_hitbox(game_object_id, f"Animator special-touch region {index}", components_by_game_object, component_readers, required=True)
        for index, game_object_id in enumerate(special_touch_game_object_ids)
    ]

    parts_views = [
        export_parts_view(component_id, tree, set(game_objects), object_types, transforms_by_id)
        for component_id, tree in mono_behaviours
        if "_listParts" in tree and "_listParts2" in tree and "_listBg" in tree
    ]

    material_switchers = [
        export_material_rplus_switcher(component_id, tree, object_types, component_readers)
        for component_id, tree in mono_behaviours
        if "_materialVariants" in tree and "_rendererUses" in tree
    ]

    sprite_switchers = [
        export_sprite_rplus_switcher(component_id, tree, object_types)
        for component_id, tree in mono_behaviours
        if "_CapturedSprite" in tree
    ]

    mosaics = [
        export_mosaic(component_id, tree, object_types, components_by_game_object)
        for component_id, tree in mono_behaviours
        if "referenceScreenSize" in tree and "minMultiplier" in tree and "maxMultiplier" in tree
    ]

    return {
        "actor": {
            "componentId": actor_component_id,
            "gameObjectId": actor_game_object_id,
            "face": {
                "rendererId": face_renderer_id,
                "names": face_names
            },
            "hitboxes": {
                "touch": touch_hitbox,
                "specialTouch": special_hitboxes
            }
        },
        "partsViews": parts_views,
        "rplus": {
            "materialSwitchers": material_switchers,
            "spriteSwitchers": sprite_switchers
        },
        "mosaics": mosaics
    }


def export_puppet2d_ik_handles(hierarchy: dict, component_readers: dict[int, Any]) -> list[dict]:
    transforms_by_id = {
        transform["id"]: transform
        for transform in hierarchy["transforms"]
    }
    transform_ids_by_game_object_id = {
        transform["gameObjectId"]: transform["id"]
        for transform in hierarchy["transforms"]
    }

    def require_transform_reference(tree: dict, field_name: str, context: str) -> str:
        transform_id = typetree_object_id(tree.get(field_name), f"{context} {field_name}", required=True)

        if transform_id not in transforms_by_id:
            raise ValueError(f'{context} {field_name} is outside the Animator hierarchy.')

        return transform_id

    handles = []

    for reader in component_readers.values():
        if reader.type.name != "MonoBehaviour":
            continue

        if get_mono_behaviour_class_name(reader) != "Puppet2D_IKHandle":
            continue

        component_id = str(reader.path_id)
        context = f'Puppet2D IK handle "{component_id}"'
        tree = reader.read_typetree()

        if not isinstance(tree, dict):
            raise ValueError(f"{context} has invalid serialized data.")

        mode = int(tree.get("numberIkBonesIndex", 0))

        if mode != 0:
            raise ValueError(f"{context} uses unsupported multi-bone IK mode {mode}.")

        game_object_id = typetree_object_id(tree.get("m_GameObject"), f"{context} GameObject", required=True)
        control_transform_id = transform_ids_by_game_object_id.get(game_object_id)

        if control_transform_id is None:
            raise ValueError(f"{context} has no Transform in the Animator hierarchy.")

        top_joint_transform_id = require_transform_reference(tree, "topJointTransform", context)
        middle_joint_transform_id = require_transform_reference(tree, "middleJointTransform", context)
        bottom_joint_transform_id = require_transform_reference(tree, "bottomJointTransform", context)
        pole_transform_id = require_transform_reference(tree, "poleVector", context)

        joint_ids = {
            top_joint_transform_id,
            middle_joint_transform_id,
            bottom_joint_transform_id
        }

        if len(joint_ids) != 3:
            raise ValueError(f"{context} contains duplicate joint references.")

        raw_scale_start = tree.get("scaleStart")

        if not isinstance(raw_scale_start, list) or len(raw_scale_start) != 2:
            raise ValueError(f"{context} has invalid starting scales.")

        handles.append({
            "componentId": component_id,
            "enabled": bool(tree.get("m_Enabled", True)),
            "controlTransformId": control_transform_id,
            "poleTransformId": pole_transform_id,
            "topJointTransformId": top_joint_transform_id,
            "middleJointTransformId": middle_joint_transform_id,
            "bottomJointTransformId": bottom_joint_transform_id,
            "flip": bool(tree.get("Flip", False)),
            "squashAndStretch": bool(tree.get("SquashAndStretch", False)),
            "scaleBottomJoint": bool(tree.get("Scale", False)),
            "aimDirection": typetree_vector(tree.get("AimDirection"), ("x", "y", "z"), f"{context} aim direction"),
            "upDirection": typetree_vector(tree.get("UpDirection"), ("x", "y", "z"), f"{context} up direction"),
            "scaleStart": [
                typetree_vector(value, ("x", "y", "z"), f"{context} starting scale {index}")
                for index, value in enumerate(raw_scale_start)
            ],
            "offsetScale": typetree_vector(tree.get("OffsetScale"), ("x", "y", "z"), f"{context} scale offset"),
            "offsetRotation": typetree_vector(tree.get("Offset"), ("x", "y", "z", "w"), f"{context} rotation offset")
        })

    if len(handles) > MAXIMUM_PUPPET2D_IK_HANDLES:
        raise ValueError("The Animator runtime contains too many Puppet2D IK handles.")

    handles.sort(key=lambda handle: int(handle["componentId"]))

    return handles


def export_puppet2d_spline_controls(hierarchy: dict, component_readers: dict[int, Any]) -> list[dict]:
    transforms_by_id = {
        transform["id"]: transform
        for transform in hierarchy["transforms"]
    }
    transform_ids_by_game_object_id = {
        transform["gameObjectId"]: transform["id"]
        for transform in hierarchy["transforms"]
    }

    controls: list[dict] = []

    for reader in component_readers.values():
        if reader.type.name != "MonoBehaviour":
            continue

        if get_mono_behaviour_class_name(reader) != "Puppet2D_SplineControl":
            continue

        component_id = str(reader.path_id)
        context = f'Puppet2D spline control "{component_id}"'
        tree = reader.read_typetree()

        if not isinstance(tree, dict):
            raise ValueError(f"{context} has invalid serialized data.")

        game_object_id = typetree_object_id(tree.get("m_GameObject"), f"{context} GameObject", required=True)
        component_transform_id = transform_ids_by_game_object_id.get(game_object_id)

        if component_transform_id is None:
            raise ValueError(f"{context} has no Transform in the Animator hierarchy.")

        control_transform_ids = typetree_object_ids(tree.get("_splineCTRLS"), f"{context} controls")

        if len(control_transform_ids) < 4:
            raise ValueError(f"{context} has fewer than four spline controls.")

        for transform_id in control_transform_ids:
            if transform_id not in transforms_by_id:
                raise ValueError(f'{context} references control Transform "{transform_id}" outside the Animator hierarchy.')

        samples = int(tree.get("numberBones", 0))

        if samples <= 0:
            raise ValueError(f"{context} has an invalid sample count.")

        bone_game_object_ids = typetree_object_ids(tree.get("bones"), f"{context} output bones")
        bone_transform_ids: list[str] = []

        for bone_game_object_id in bone_game_object_ids:
            transform_id = transform_ids_by_game_object_id.get(bone_game_object_id)

            if transform_id is None:
                raise ValueError(f'{context} output GameObject "{bone_game_object_id}" has no Transform in the Animator hierarchy.')

            bone_transform_ids.append(transform_id)

        expected_count = (len(control_transform_ids) - 3) * samples + 1

        if expected_count != len(bone_transform_ids):
            raise ValueError(f"{context} produces {expected_count} spline points but references {len(bone_transform_ids)} output bones.")

        if expected_count > MAXIMUM_PUPPET2D_SPLINE_POINTS:
            raise ValueError(f"{context} produces too many spline points.")

        if len(set(bone_transform_ids)) != len(bone_transform_ids):
            raise ValueError(f"{context} contains duplicate output bones.")

        controls.append({
            "componentId": component_id,
            "componentTransformId": component_transform_id,
            "controlTransformIds": control_transform_ids,
            "samples": samples,
            "boneTransformIds": bone_transform_ids
        })

    if len(controls) > MAXIMUM_PUPPET2D_SPLINE_CONTROLS:
        raise ValueError("The Animator runtime contains too many Puppet2D spline controls.")

    controls.sort(key=lambda control: int(control["componentId"]))

    return controls


def export_particle_system(particle_reader: Any) -> dict:
    tree = particle_reader.read_typetree()
    component_id = str(particle_reader.path_id)
    game_object_id = typetree_object_id(tree.get("m_GameObject"), f'ParticleSystem "{component_id}" GameObject', required=True)

    modules = {}

    for module_name in PARTICLE_SYSTEM_MODULE_NAMES:
        module = tree.get(module_name)

        if not isinstance(module, dict):
            raise ValueError(f'ParticleSystem "{component_id}" has an invalid {module_name}.')

        modules[module_name] = module

    return {
        "id": component_id,
        "gameObjectId": game_object_id,
        "length": require_finite_float(tree.get("lengthInSec"), f'ParticleSystem "{component_id}" duration'),
        "simulationSpeed": require_finite_float(tree.get("simulationSpeed"), f'ParticleSystem "{component_id}" simulation speed'),
        "looping": bool(tree.get("looping", False)),
        "prewarm": bool(tree.get("prewarm", False)),
        "playOnAwake": bool(tree.get("playOnAwake", False)),
        "useUnscaledTime": bool(tree.get("useUnscaledTime", False)),
        "autoRandomSeed": bool(tree.get("autoRandomSeed", True)),
        "randomSeed": int(tree.get("randomSeed", 0)),
        "moveWithTransform": int(tree.get("moveWithTransform", 0)),
        "scalingMode": int(tree.get("scalingMode", 0)),
        "startDelay": tree.get("startDelay"),
        "modules": modules
    }


def export_scene(environment: Any, writer: GeometryWriter, locator: str, texture_directory: Path) -> tuple[dict, list[dict]]:
    hierarchy = collect_hierarchy(environment, locator)
    component_readers = hierarchy.pop("componentReaders")

    skinned_renderers = []
    sprite_renderers = []
    particle_systems = []
    particle_renderers = []
    mesh_renderers = []
    mesh_readers = {}
    material_readers = {}
    mesh_filter_mesh_ids_by_game_object: dict[str, str | None] = {}

    for component_reader in component_readers.values():
        if component_reader.type.name != "MeshFilter":
            continue

        mesh_filter = component_reader.parse_as_object()
        game_object_id = object_id(mesh_filter.m_GameObject)

        if game_object_id is None:
            raise ValueError(f'MeshFilter "{component_reader.path_id}" has no GameObject.')

        if game_object_id in mesh_filter_mesh_ids_by_game_object:
            raise ValueError(f'GameObject "{game_object_id}" has multiple MeshFilters.')

        mesh_id = object_id(mesh_filter.m_Mesh)
        mesh_filter_mesh_ids_by_game_object[game_object_id] = mesh_id

        if mesh_id:
            mesh_readers[int(mesh_filter.m_Mesh.path_id)] = mesh_filter.m_Mesh.deref()

    for component_reader in component_readers.values():
        component_type = component_reader.type.name

        if component_type == "SkinnedMeshRenderer":
            renderer = component_reader.parse_as_object()

            mesh_id = object_id(renderer.m_Mesh)

            if mesh_id:
                mesh_readers[int(renderer.m_Mesh.path_id)] = renderer.m_Mesh.deref()

            for material in renderer.m_Materials:
                if material.path_id:
                    material_readers[int(material.path_id)] = material.deref()

            skinned_renderers.append({
                "id": str(component_reader.path_id),
                "gameObjectId": object_id(renderer.m_GameObject),
                "enabled": bool(renderer.m_Enabled),
                "meshId": mesh_id,
                "materialIds": [object_id(material) for material in renderer.m_Materials],
                "boneTransformIds": [object_id(bone) for bone in renderer.m_Bones],
                "rootBoneTransformId": object_id(renderer.m_RootBone),
                "blendShapeWeights": [float(weight) for weight in renderer.m_BlendShapeWeights],
                "sortingLayerId": int(renderer.m_SortingLayerID),
                "sortingOrder": int(renderer.m_SortingOrder),
                "bounds": {
                    "center": vector3(renderer.m_AABB.m_Center),
                    "extent": vector3(renderer.m_AABB.m_Extent)
                }
            })

        elif component_type == "SpriteRenderer":
            renderer = component_reader.parse_as_object()

            for material in renderer.m_Materials:
                if material.path_id:
                    material_readers[int(material.path_id)] = material.deref()

            sprite_renderers.append({
                "id": str(component_reader.path_id),
                "gameObjectId": object_id(renderer.m_GameObject),
                "enabled": bool(renderer.m_Enabled),
                "spriteId": object_id(renderer.m_Sprite),
                "materialIds": [object_id(material) for material in renderer.m_Materials],
                "color": color(renderer.m_Color),
                "flipX": bool(renderer.m_FlipX),
                "flipY": bool(renderer.m_FlipY),
                "size": vector2(renderer.m_Size),
                "sortingLayerId": int(renderer.m_SortingLayerID),
                "sortingOrder": int(renderer.m_SortingOrder)
            })

        elif component_type == "ParticleSystem":
            particle_systems.append(export_particle_system(component_reader))

        elif component_type == "ParticleSystemRenderer":
            renderer = component_reader.parse_as_object()
            mesh_id = object_id(renderer.m_Mesh)

            if mesh_id:
                mesh_readers[int(renderer.m_Mesh.path_id)] = renderer.m_Mesh.deref()

            for material in renderer.m_Materials:
                if material.path_id:
                    material_readers[int(material.path_id)] = material.deref()

            particle_renderers.append({
                "id": str(component_reader.path_id),
                "gameObjectId": object_id(renderer.m_GameObject),
                "enabled": bool(renderer.m_Enabled),
                "meshId": mesh_id,
                "materialIds": [
                    object_id(material)
                    for material in renderer.m_Materials
                ],
                "sortingLayerId": int(renderer.m_SortingLayerID),
                "sortingOrder": int(renderer.m_SortingOrder),
                "renderMode": int(renderer.m_RenderMode),
                "sortMode": int(renderer.m_SortMode),
                "renderAlignment": int(renderer.m_RenderAlignment),
                "minimumParticleSize": require_finite_float(renderer.m_MinParticleSize, "ParticleSystemRenderer minimum particle size"),
                "maximumParticleSize": require_finite_float(renderer.m_MaxParticleSize, "ParticleSystemRenderer maximum particle size"),
                "velocityScale": require_finite_float(renderer.m_VelocityScale, "ParticleSystemRenderer velocity scale"),
                "lengthScale": require_finite_float(renderer.m_LengthScale, "ParticleSystemRenderer length scale"),
                "sortingFudge": require_finite_float(renderer.m_SortingFudge, "ParticleSystemRenderer sorting fudge"),
                "pivot": vector3(renderer.m_Pivot),
                "flip": vector3(renderer.m_Flip)
            })

        elif component_type == "MeshRenderer":
            renderer = component_reader.parse_as_object()
            game_object_id = object_id(renderer.m_GameObject)

            if game_object_id is None:
                raise ValueError(f'MeshRenderer "{component_reader.path_id}" has no GameObject.')

            for material in renderer.m_Materials:
                if material.path_id:
                    material_readers[int(material.path_id)] = material.deref()

            mesh_renderers.append({
                "id": str(component_reader.path_id),
                "gameObjectId": game_object_id,
                "enabled": bool(renderer.m_Enabled),
                "meshId": mesh_filter_mesh_ids_by_game_object.get(game_object_id),
                "materialIds": [
                    object_id(material)
                    for material in renderer.m_Materials
                ],
                "sortingLayerId": int(renderer.m_SortingLayerID),
                "sortingOrder": int(renderer.m_SortingOrder)
            })

    if len(mesh_readers) > MAXIMUM_MESHES:
        raise ValueError("The Animator runtime contains too many meshes.")

    meshes = [
        export_mesh(reader, writer)
        for _, reader in sorted(mesh_readers.items())
    ]

    materials = [
        export_material(reader)
        for _, reader in sorted(material_readers.items())
    ]

    texture_readers = [
        obj for obj in environment.objects
        if obj.type.name == "Texture2D"
    ]

    if len(texture_readers) > MAXIMUM_TEXTURES:
        raise ValueError("The Animator runtime contains too many textures.")

    textures = [
        export_texture(reader, texture_directory)
        for reader in texture_readers
    ]

    texture_sizes_by_id = {
        texture["id"]: (texture["width"], texture["height"])
        for texture in textures
    }

    sprite_readers = [
        obj for obj in environment.objects
        if obj.type.name == "Sprite"
    ]

    if len(sprite_readers) > MAXIMUM_SPRITES:
        raise ValueError("The Animator runtime contains too many sprites.")

    sprites = [
        export_sprite(reader, writer, texture_sizes_by_id)
        for reader in sprite_readers
    ]

    exported_sprite_ids = {
        sprite["id"]
        for sprite in sprites
    }

    for renderer in sprite_renderers:
        sprite_id = renderer["spriteId"]

        if sprite_id is not None and sprite_id not in exported_sprite_ids:
            renderer["spriteId"] = None
    
    interactions = export_animator_interactions(environment, hierarchy, component_readers)
    puppet2d_ik_handles = export_puppet2d_ik_handles(hierarchy, component_readers)
    puppet2d_spline_controls = export_puppet2d_spline_controls(hierarchy, component_readers)

    if len(particle_systems) > MAXIMUM_PARTICLE_SYSTEMS:
        raise ValueError("The Animator runtime contains too many particle systems.")

    particle_system_ids_by_game_object: dict[str, str] = {}

    for particle_system in particle_systems:
        game_object_id = particle_system["gameObjectId"]

        if game_object_id in particle_system_ids_by_game_object:
            raise ValueError(f'GameObject "{game_object_id}" has multiple ParticleSystems.')

        particle_system_ids_by_game_object[game_object_id] = particle_system["id"]

    for renderer in particle_renderers:
        particle_system_id = particle_system_ids_by_game_object.get(renderer["gameObjectId"])

        if particle_system_id is None:
            raise ValueError(f'ParticleSystemRenderer "{renderer["id"]}" has no ParticleSystem.')

        renderer["particleSystemId"] = particle_system_id

    return {
        **hierarchy,
        "meshes": meshes,
        "materials": materials,
        "sprites": sprites,
        "meshRenderers": mesh_renderers,
        "skinnedMeshRenderers": skinned_renderers,
        "spriteRenderers": sprite_renderers,
        "interactions": interactions,
        "puppet2dIkHandles": puppet2d_ik_handles,
        "puppet2dSplineControls": puppet2d_spline_controls,
        "particleSystems": particle_systems,
        "particleSystemRenderers": particle_renderers
    }, textures


def export_animator_scene(environment: Any, destination: Path, texture_directory: Path, locator: str) -> tuple[dict, dict, list[dict]]:
    writer = GeometryWriter(destination)

    try:
        scene, textures = export_scene(environment, writer, locator, texture_directory)
    finally:
        writer.close()

    return scene, {
        "file": GEOMETRY_FILE_NAME,
        "magic": GEOMETRY_MAGIC.rstrip(b"\0").decode("ascii"),
        "byteLength": destination.stat().st_size
    }, textures
