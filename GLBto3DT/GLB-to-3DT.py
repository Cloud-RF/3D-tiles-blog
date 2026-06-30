#!/usr/bin/env python3
"""
tile_pipeline.py — One-step GLB → positioned 3D Tiles pyramid.

Combines TilesBlosm.py (positioning) + glb_to_3dtiles.py (tiling) into a
single pipeline. Optionally compresses output tiles with gltf-transform.

Handles Draco-compressed input GLBs and WebP textures automatically.

Usage:
  # Lat/lon (elevation looked up automatically)
  python3 tile_pipeline.py model.glb ./output --lat 60.162 --lon 24.945

  # Blosm bounding box
  python3 tile_pipeline.py model.glb ./output --bbox 60.1553 24.9415 60.1568 24.9469

  # Manual ground elevation + height above ground
  python3 tile_pipeline.py model.glb ./output --lat 45.218 --lon -112.125 --ground 1800 --hag 5

  # Inherit position from existing tileset.json
  python3 tile_pipeline.py model.glb ./output --tileset tileset.json

  # With gltf-transform compression (requires gltf-transform on PATH)
  python3 tile_pipeline.py model.glb ./output --lat 60.162 --lon 24.945 --compress

  # Centre model at origin before tiling (fixes offset/misplaced models)
  python3 tile_pipeline.py model.glb ./output --lat 51.5237 --lon -0.0756 --centre

  # Snap model base to Z=0 so it sits on the ground plane (fixes models appearing underground)
  python3 tile_pipeline.py model.glb ./output --lat 51.5237 --lon -0.0756 --ground-snap

Dependencies:
  pip install pygltflib trimesh numpy Pillow
  Optional: pip install DracoPy  (for Draco-compressed input GLBs)
  Optional: npm install -g @gltf-transform/cli  (for --compress)
"""

import sys, os, json, math, struct, argparse, subprocess, glob
import urllib.request, urllib.error
import numpy as np

try:
    import pygltflib
    import trimesh
    from PIL import Image
    import io
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install pygltflib trimesh numpy Pillow")
    sys.exit(1)

try:
    import DracoPy
    DRACO_AVAILABLE = True
except ImportError:
    DRACO_AVAILABLE = False


# ===========================================================================
# Config
# ===========================================================================
LEAF_GRID  = 8
MID_GRID   = 4
LOD_RATIOS = {"root": 0.05, "mid": 0.25, "leaf": 1.0}
TEX_SCALES = {"root": 0.25, "mid": 0.5,  "leaf": 1.0}


# ===========================================================================
# Height ramp (Blender default Color Ramp spectrum), low -> high
# ===========================================================================
_SPECTRUM = [
    (0.00, (0.0, 0.0, 1.0)),   # blue
    (0.25, (0.0, 1.0, 1.0)),   # cyan
    (0.50, (0.0, 1.0, 0.0)),   # green
    (0.75, (1.0, 1.0, 0.0)),   # yellow
    (1.00, (1.0, 0.0, 0.0)),   # red
]


def make_gradient_texture(width=256, invert=False):
    """Build a 1px-tall horizontal gradient strip (PNG bytes) from the spectrum.
    U=0 -> low (blue), U=1 -> high (red). Returns (png_bytes, 'image/png')."""
    stops_pos = np.array([s[0] for s in _SPECTRUM])
    stops_col = np.array([s[1] for s in _SPECTRUM])
    u = np.linspace(0.0, 1.0, width, dtype=np.float32)
    if invert:
        u = 1.0 - u
    row = np.zeros((width, 3), dtype=np.float32)
    for ch in range(3):
        row[:, ch] = np.interp(u, stops_pos, stops_col[:, ch])
    img_arr = (np.clip(row, 0, 1) * 255).astype(np.uint8).reshape(1, width, 3)
    img = Image.fromarray(img_arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def bake_height_ramp(primitives, zmin=None, zmax=None, invert=False, tex_width=256):
    """Bake a height gradient as a 1D texture + per-vertex UVs (ATAK-friendly).

    The gradient is 1-dimensional (colour depends only on normalised height),
    so each vertex's U coordinate is set to its normalised height and V is fixed
    at 0.5. Every primitive shares the same small gradient-strip texture. This
    carries colour the way ATAK honours (baseColorTexture) rather than COLOR_0.

    Computed on loaded geometry, so the result is identical whether or not
    --centre / --ground-snap were applied (those are pure translations).
    """
    all_z = np.concatenate([p["verts"][:, 2] for p in primitives])
    lo = zmin if zmin is not None else float(all_z.min())
    hi = zmax if zmax is not None else float(all_z.max())
    span = (hi - lo) or 1.0
    src = "manual" if (zmin is not None or zmax is not None) else "auto"
    print(f"  Height ramp Z range: {lo:.3f} to {hi:.3f} m ({src})")

    grad_bytes, grad_mime = make_gradient_texture(tex_width, invert=invert)

    # Inset U slightly so edge texels aren't clipped by sampler clamp/filtering.
    half_texel = 0.5 / tex_width
    for p in primitives:
        t = np.clip((p["verts"][:, 2] - lo) / span, 0.0, 1.0)
        u = half_texel + t * (1.0 - 2.0 * half_texel)
        uvs = np.column_stack([u, np.full_like(u, 0.5)]).astype(np.float32)
        p["uvs"]       = uvs            # override any existing UVs with ramp UVs
        p["tex_bytes"] = grad_bytes     # shared gradient strip
        p["tex_mime"]  = grad_mime
        p["ramp_tex"]  = True           # mark so build_glb keeps it at full res
        p["colors"]    = None           # not using vertex colours for the ramp
    total_v = sum(len(p["verts"]) for p in primitives)
    print(f"  Baked height-ramp texture ({tex_width}x1) + UVs for {total_v} vertices "
          f"across {len(primitives)} primitive(s)")


# ===========================================================================
# Elevation lookup
# ===========================================================================

def get_elevation_open_meteo(lat, lon):
    url = f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
        return data["elevation"][0], "Open-Meteo (Copernicus DEM GLO-90)"


def get_elevation_open_elevation(lat, lon):
    url = f"https://api.open-elevation.com/api/v1/lookup?locations={lat},{lon}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
        return data["results"][0]["elevation"], "Open-Elevation (SRTM)"


def lookup_elevation(lat, lon):
    try:
        return get_elevation_open_meteo(lat, lon)
    except Exception as e1:
        print(f"  Warning: Open-Meteo failed: {e1}")
        print("  Trying fallback (Open-Elevation)...")
        try:
            return get_elevation_open_elevation(lat, lon)
        except Exception as e2:
            raise RuntimeError(
                f"Both elevation APIs failed.\n  Primary: {e1}\n  Fallback: {e2}\n"
                f"  Use --ground to set elevation manually."
            )


# ===========================================================================
# ECEF transform
# ===========================================================================

def ecef_transform(lat_deg, lon_deg, height_m):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    a, e2 = 6378137.0, 0.00669437999014
    N  = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    X  = (N + height_m) * math.cos(lat) * math.cos(lon)
    Y  = (N + height_m) * math.cos(lat) * math.sin(lon)
    Z  = (N * (1 - e2) + height_m) * math.sin(lat)
    # ENU basis vectors expressed in ECEF
    ex, ey     = -math.sin(lon), math.cos(lon)                                              # East (no Z component)
    nx, ny, nz = -math.sin(lat)*math.cos(lon), -math.sin(lat)*math.sin(lon), math.cos(lat)  # North
    ux, uy, uz =  math.cos(lat)*math.cos(lon),  math.cos(lat)*math.sin(lon), math.sin(lat)  # Up
    # 3D Tiles transform is COLUMN-MAJOR: columns = [East, North, Up, Translation].
    return [ex, ey, 0,  0,                          # col 0: East
            nx, ny, nz, 0,                          # col 1: North
            ux, uy, uz, 0,                          # col 2: Up
            round(X,3), round(Y,3), round(Z,3), 1]  # col 3: origin


def bbox_to_centre(min_lat, min_lon, max_lat, max_lon):
    centre_lat = (min_lat + max_lat) / 2
    centre_lon = (min_lon + max_lon) / 2
    lat_m = (max_lat - min_lat) * 111320
    lon_m = (max_lon - min_lon) * 111320 * math.cos(math.radians(centre_lat))
    radius = round(math.sqrt(lat_m**2 + lon_m**2) / 2, 1)
    return centre_lat, centre_lon, radius


# ===========================================================================
# GLB centring (fixes models with non-zero origin)
# ===========================================================================

def centre_glb(input_path, output_path):
    """Load GLB via trimesh, translate centroid to origin, re-export."""
    print(f"  Loading for centring: {input_path}")
    scene = trimesh.load(input_path, force="scene")
    centroid = scene.centroid
    print(f"  Original centroid: [{centroid[0]:.3f}, {centroid[1]:.3f}, {centroid[2]:.3f}]")
    if any(abs(c) > 1.0 for c in centroid):
        scene.apply_translation(-centroid)
        scene.export(output_path)
        print(f"  Centred and saved to: {output_path}")
    else:
        print(f"  Centroid already near origin — skipping translation")
        import shutil
        shutil.copy2(input_path, output_path)
    return output_path


def ground_snap_glb(input_path, output_path):
    """Translate model so its lowest point sits at Z=0 (base on ground plane)."""
    print(f"  Loading for ground snap: {input_path}")
    scene = trimesh.load(input_path, force="scene")
    min_z = scene.bounds[0][2]
    max_z = scene.bounds[1][2]
    print(f"  Z bounds: min={min_z:.3f} m, max={max_z:.3f} m, height={max_z - min_z:.3f} m")
    if abs(min_z) > 0.01:
        scene.apply_translation([0, 0, -min_z])
        scene.export(output_path)
        print(f"  Lifted by {-min_z:.3f} m — base now at Z=0")
    else:
        print(f"  Base already at Z=0 — skipping")
        import shutil
        shutil.copy2(input_path, output_path)
    return output_path


# ===========================================================================
# GLB loading (handles standard, Draco-compressed, and WebP textures)
# ===========================================================================

def load_glb(path):
    print(f"Loading: {path}")
    gltf   = pygltflib.GLTF2().load(path)
    binary = gltf.binary_blob()

    draco_input = bool(gltf.extensionsRequired and
                       "KHR_draco_mesh_compression" in gltf.extensionsRequired)
    webp_input  = bool(gltf.extensionsUsed and
                       "EXT_texture_webp" in gltf.extensionsUsed)
    if draco_input:
        print("  Detected Draco compression — decoding on load")
        if not DRACO_AVAILABLE:
            print("  ERROR: DracoPy not installed. pip install DracoPy")
            sys.exit(1)
    if webp_input:
        print("  Detected WebP textures — converting to JPEG on load")

    def read_accessor(acc_idx):
        acc  = gltf.accessors[acc_idx]
        bv   = gltf.bufferViews[acc.bufferView]
        start = (bv.byteOffset or 0) + (acc.byteOffset or 0)
        comp  = {5120:'i1',5121:'u1',5122:'i2',5123:'u2',5125:'u4',5126:'f4'}
        ncomp = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
        dtype = np.dtype(comp[acc.componentType])
        nc    = ncomp[acc.type]
        stride = bv.byteStride if bv.byteStride else dtype.itemsize * nc
        raw = binary[start: start + acc.count * stride]
        if stride == dtype.itemsize * nc:
            arr = np.frombuffer(raw, dtype=dtype)
            return arr.reshape(acc.count, nc) if nc > 1 else arr
        else:
            arr = np.zeros((acc.count, nc), dtype=dtype)
            for i in range(acc.count):
                o = i * stride
                arr[i] = np.frombuffer(raw[o: o + dtype.itemsize * nc], dtype=dtype)
            return arr

    def decode_draco_prim(prim):
        ext  = prim.extensions["KHR_draco_mesh_compression"]
        bv   = gltf.bufferViews[ext["bufferView"]]
        start = bv.byteOffset or 0
        raw  = binary[start: start + bv.byteLength]
        dec  = DracoPy.decode(raw)
        verts = np.array(dec.points, dtype=np.float64)
        faces = np.array(dec.faces,  dtype=np.int32)
        uvs   = None
        if hasattr(dec, "tex_coord") and dec.tex_coord is not None:
            uvs = np.array(dec.tex_coord, dtype=np.float32)
        return verts, faces, uvs

    def read_image(img_idx):
        img  = gltf.images[img_idx]
        bv   = gltf.bufferViews[img.bufferView]
        start = bv.byteOffset or 0
        raw  = binary[start: start + bv.byteLength]
        mime = img.mimeType or "image/jpeg"
        if mime == "image/webp" or raw[:4] == b"RIFF":
            try:
                pil_img = Image.open(io.BytesIO(raw)).convert("RGB")
                buf = io.BytesIO()
                pil_img.save(buf, format="JPEG", quality=90)
                return buf.getvalue(), "image/jpeg"
            except Exception:
                pass
        return raw, mime

    def get_texture(mat):
        if not mat or not mat.pbrMetallicRoughness:
            return None, "image/jpeg"
        pbr = mat.pbrMetallicRoughness
        if not pbr.baseColorTexture:
            return None, "image/jpeg"
        tex_idx = pbr.baseColorTexture.index
        tex     = gltf.textures[tex_idx]
        img_idx = tex.source
        if hasattr(tex, "extensions") and tex.extensions:
            webp_ext = tex.extensions.get("EXT_texture_webp", {})
            if "source" in webp_ext:
                img_idx = webp_ext["source"]
        if img_idx is None:
            return None, "image/jpeg"
        return read_image(img_idx)

    # --- Scene graph walk: bake node transforms into vertex positions ---

    def node_local_matrix(node):
        """Get a node's local 4x4 transform matrix."""
        if node.matrix:
            return np.array(node.matrix, dtype=np.float64).reshape(4, 4, order='F')
        mat = np.eye(4, dtype=np.float64)
        if node.scale:
            mat[0,0], mat[1,1], mat[2,2] = node.scale
        if node.rotation:
            # quaternion (x,y,z,w) to rotation matrix
            x, y, z, w = node.rotation
            mat[:3,:3] = np.array([
                [1-2*(y*y+z*z), 2*(x*y-w*z),   2*(x*z+w*y)],
                [2*(x*y+w*z),   1-2*(x*x+z*z), 2*(y*z-w*x)],
                [2*(x*z-w*y),   2*(y*z+w*x),   1-2*(x*x+y*y)],
            ]) @ np.diag(mat.diagonal()[:3])
        if node.translation:
            mat[0,3], mat[1,3], mat[2,3] = node.translation
        return mat

    def transform_verts(verts, world_mat):
        """Apply a 4x4 matrix to Nx3 vertices."""
        if np.allclose(world_mat, np.eye(4), atol=1e-6):
            return verts
        ones = np.ones((len(verts), 1), dtype=np.float64)
        v4 = np.hstack([verts, ones])  # Nx4
        v4 = (world_mat @ v4.T).T      # Nx4
        return v4[:, :3]

    def collect_primitives(node_idx, parent_world):
        """Recursively walk the scene graph and collect primitives with baked transforms."""
        node = gltf.nodes[node_idx]
        local = node_local_matrix(node)
        world = parent_world @ local

        results = []
        if node.mesh is not None:
            mesh = gltf.meshes[node.mesh]
            for prim in mesh.primitives:
                if draco_input and prim.extensions and "KHR_draco_mesh_compression" in prim.extensions:
                    verts, faces, uvs = decode_draco_prim(prim)
                    colors = None  # Draco colour attrs not decoded here; height-ramp can still apply
                else:
                    verts = read_accessor(prim.attributes.POSITION).astype(np.float64)
                    uvs   = None
                    if prim.attributes.TEXCOORD_0 is not None:
                        uvs = read_accessor(prim.attributes.TEXCOORD_0).astype(np.float32)
                    if prim.indices is not None:
                        faces = read_accessor(prim.indices).flatten().astype(np.int32).reshape(-1, 3)
                    else:
                        faces = np.arange(len(verts), dtype=np.int32).reshape(-1, 3)

                # Read existing vertex colours (COLOR_0) if present
                colors = None
                color_acc = getattr(prim.attributes, "COLOR_0", None)
                if color_acc is not None:
                    raw_c = read_accessor(color_acc).astype(np.float32)
                    acc = gltf.accessors[color_acc]
                    # Normalise integer-encoded colours to [0,1]
                    if acc.componentType == 5121:    # unsigned byte
                        raw_c = raw_c / 255.0
                    elif acc.componentType == 5123:  # unsigned short
                        raw_c = raw_c / 65535.0
                    if raw_c.ndim == 1:
                        raw_c = raw_c.reshape(-1, 1)
                    if raw_c.shape[1] == 3:           # promote RGB -> RGBA
                        raw_c = np.hstack([raw_c, np.ones((len(raw_c), 1), dtype=np.float32)])
                    colors = raw_c

                # Bake world transform into vertex positions
                verts = transform_verts(verts, world)

                mat = gltf.materials[prim.material] if prim.material is not None else None
                tex_bytes, tex_mime = get_texture(mat)

                results.append({
                    "verts": verts, "faces": faces, "uvs": uvs,
                    "colors": colors,
                    "tex_bytes": tex_bytes, "tex_mime": tex_mime,
                    "centroid": verts.mean(axis=0),
                })

        if node.children:
            for child_idx in node.children:
                results.extend(collect_primitives(child_idx, world))

        return results

    primitives = []
    for root_node_idx in gltf.scenes[gltf.scene or 0].nodes:
        primitives.extend(collect_primitives(root_node_idx, np.eye(4)))

    print(f"  Primitives : {len(primitives)}")
    xs = [p["centroid"][0] for p in primitives]
    zs = [p["centroid"][2] for p in primitives]
    print(f"  X range    : {min(xs):.1f} to {max(xs):.1f}")
    print(f"  Z range    : {min(zs):.1f} to {max(zs):.1f}")
    return primitives


# ===========================================================================
# Spatial grid, decimation, texture resize
# ===========================================================================

def assign_to_grid(primitives, grid_size):
    xs = np.array([p["centroid"][0] for p in primitives])
    zs = np.array([p["centroid"][2] for p in primitives])
    xmin, xmax = xs.min(), xs.max()
    zmin, zmax = zs.min(), zs.max()
    xspan = xmax - xmin or 1.0
    zspan = zmax - zmin or 1.0
    grid = {}
    for i, p in enumerate(primitives):
        col = min(int((p["centroid"][0] - xmin) / xspan * grid_size), grid_size - 1)
        row = min(int((p["centroid"][2] - zmin) / zspan * grid_size), grid_size - 1)
        grid.setdefault((col, row), []).append(i)
    return grid, (xmin, xmax, zmin, zmax)


def decimate(verts, faces, uvs, ratio, colors=None):
    if ratio >= 1.0 or len(faces) < 50:
        return verts, faces, uvs, colors
    target = max(4, int(len(faces) * ratio))
    try:
        mesh  = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        mesh  = mesh.simplify_quadric_decimation(target)
        new_v = np.array(mesh.vertices, dtype=np.float64)
        new_f = np.array(mesh.faces, dtype=np.int32)
        new_uvs = None
        new_colors = None
        if uvs is not None or colors is not None:
            from trimesh.proximity import closest_point
            orig = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
            _, _, idx = closest_point(orig, new_v)
            if uvs is not None:
                new_uvs = uvs[idx].astype(np.float32)
            if colors is not None:
                new_colors = colors[idx].astype(np.float32)
        return new_v, new_f, new_uvs, new_colors
    except Exception:
        return verts, faces, uvs, colors


def resize_tex(tex_bytes, tex_mime, scale):
    """Resize texture. Returns (bytes, mime_type). Preserves format at scale=1.0."""
    if tex_bytes is None:
        return None, tex_mime
    if scale >= 1.0:
        return tex_bytes, tex_mime
    try:
        img = Image.open(io.BytesIO(tex_bytes))
        new_w = max(16, int(img.width  * scale))
        new_h = max(16, int(img.height * scale))
        img = img.resize((new_w, new_h), Image.LANCZOS)
        # Keep original format where possible
        if tex_mime == "image/png":
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue(), "image/png"
        else:
            img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=75)
            return buf.getvalue(), "image/jpeg"
    except Exception:
        return tex_bytes, tex_mime


# ===========================================================================
# GLB builder
# ===========================================================================

def build_glb(prim_list, tex_scale=1.0):
    if not prim_list:
        return None

    accessors     = []
    buffer_views  = []
    images_json   = []
    textures_json = []
    samplers_json = []
    materials_json= []
    json_prims    = []
    buf_data      = b""
    ramp_tex_idx  = None   # shared gradient-strip texture index (set on first use)

    def add_buf(raw):
        nonlocal buf_data
        pad = (4 - len(raw) % 4) % 4
        raw = raw + b"\x00" * pad
        bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": len(buf_data),
            "byteLength": len(raw),
        })
        buf_data += raw
        return bv_idx

    for p in prim_list:
        verts = p["verts"].astype(np.float32)
        faces = p["faces"].flatten().astype(np.uint32)
        uvs   = p.get("uvs")

        v_bv = add_buf(verts.tobytes())
        buffer_views[-1]["target"] = 34962
        v_acc = len(accessors)
        accessors.append({
            "bufferView": v_bv, "componentType": 5126,
            "count": len(verts), "type": "VEC3",
            "min": verts.min(axis=0).tolist(),
            "max": verts.max(axis=0).tolist(),
        })

        f_bv = add_buf(faces.tobytes())
        buffer_views[-1]["target"] = 34963
        f_acc = len(accessors)
        accessors.append({
            "bufferView": f_bv, "componentType": 5125,
            "count": len(faces), "type": "SCALAR",
        })

        attrs = {"POSITION": v_acc}

        colors = p.get("colors")
        if colors is not None:
            colors = np.asarray(colors, dtype=np.float32)
            if colors.shape[1] == 3:  # promote RGB -> RGBA
                colors = np.hstack([colors, np.ones((len(colors), 1), dtype=np.float32)])
            c_bv = add_buf(colors.tobytes())
            buffer_views[-1]["target"] = 34962
            c_acc = len(accessors)
            accessors.append({
                "bufferView": c_bv, "componentType": 5126,
                "count": len(colors), "type": "VEC4",
            })
            attrs["COLOR_0"] = c_acc

        if uvs is not None:
            uv_bv = add_buf(uvs.astype(np.float32).tobytes())
            buffer_views[-1]["target"] = 34962
            uv_acc = len(accessors)
            accessors.append({
                "bufferView": uv_bv, "componentType": 5126,
                "count": len(uvs), "type": "VEC2",
            })
            attrs["TEXCOORD_0"] = uv_acc

        mat_idx = None
        tex_bytes = p.get("tex_bytes")
        tex_mime  = p.get("tex_mime", "image/jpeg")
        is_ramp   = bool(p.get("ramp_tex"))

        if tex_bytes is not None and uvs is not None:
            if is_ramp:
                # Tiny gradient strip: never downscale (would muddy the colours),
                # and reuse one shared image/texture per output GLB.
                if ramp_tex_idx is None:
                    img_bv  = add_buf(tex_bytes)
                    img_idx = len(images_json)
                    images_json.append({"bufferView": img_bv, "mimeType": tex_mime})
                    # Clamp-to-edge sampler so the 1D gradient never wraps.
                    samplers_json.append({"wrapS": 33071, "wrapT": 33071,
                                          "magFilter": 9729, "minFilter": 9729})
                    ramp_tex_idx = len(textures_json)
                    textures_json.append({"source": img_idx, "sampler": len(samplers_json) - 1})
                tex_idx = ramp_tex_idx
                mat_idx = len(materials_json)
                materials_json.append({
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": tex_idx, "texCoord": 0},
                        "metallicFactor": 0.0,
                        "roughnessFactor": 1.0,
                    },
                    # Unlit so the gradient shows as flat colour, unaffected by lighting.
                    "extensions": {"KHR_materials_unlit": {}},
                    "doubleSided": True,
                })
            else:
                tex_bytes, tex_mime = resize_tex(tex_bytes, tex_mime, tex_scale)
                img_bv  = add_buf(tex_bytes)
                img_idx = len(images_json)
                images_json.append({"bufferView": img_bv, "mimeType": tex_mime})
                tex_idx = len(textures_json)
                textures_json.append({"source": img_idx})
                mat_idx = len(materials_json)
                materials_json.append({
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": tex_idx, "texCoord": 0},
                        "metallicFactor": 0.0,
                        "roughnessFactor": 1.0,
                    },
                    "doubleSided": True,
                })
        elif colors is not None:
            # Vertex colours but no texture: white base so COLOR_0 shows unmodulated.
            # KHR_materials_unlit forces renderers (notably ATAK) to display the
            # vertex colour directly, independent of scene lighting. Without it,
            # some 3D Tiles engines ignore COLOR_0 and render the mesh grey/white.
            mat_idx = len(materials_json)
            materials_json.append({
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
                "extensions": {"KHR_materials_unlit": {}},
                "doubleSided": True,
            })

        pj = {"attributes": attrs, "indices": f_acc, "mode": 4}
        if mat_idx is not None:
            pj["material"] = mat_idx
        json_prims.append(pj)

    gltf_json = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": json_prims}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(buf_data)}],
    }
    if images_json:     gltf_json["images"]    = images_json
    if textures_json:   gltf_json["textures"]  = textures_json
    if samplers_json:   gltf_json["samplers"]  = samplers_json
    if materials_json:  gltf_json["materials"] = materials_json

    # Declare any extensions actually used by the emitted materials.
    used_exts = set()
    for m in materials_json:
        used_exts.update((m.get("extensions") or {}).keys())
    if used_exts:
        gltf_json["extensionsUsed"] = sorted(used_exts)

    json_bytes = json.dumps(gltf_json, separators=(',',':')).encode()
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)

    json_chunk = struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    bin_chunk  = struct.pack("<II", len(buf_data),   0x004E4942) + buf_data
    total      = 12 + len(json_chunk) + len(bin_chunk)
    return struct.pack("<III", 0x46546C67, 2, total) + json_chunk + bin_chunk


# ===========================================================================
# Bounding sphere
# ===========================================================================

def sphere_bounds(prim_list):
    """Return (cx, cy, cz, radius) bounding sphere in local coords."""
    if not prim_list:
        return [0, 0, 0, 100.0]
    all_v  = np.vstack([p["verts"] for p in prim_list])
    centre = all_v.mean(axis=0)
    radius = float(np.linalg.norm(all_v - centre, axis=1).max())
    return [float(centre[0]), float(centre[1]), float(centre[2]), radius]


# ===========================================================================
# Tiling
# ===========================================================================

def tile_glb(primitives, output_dir, transform, version="1.1"):
    tiles_dir = os.path.join(output_dir, "tiles")
    os.makedirs(tiles_dir, exist_ok=True)

    # ---- LEAF (8x8) ----
    print(f"Building {LEAF_GRID}x{LEAF_GRID} leaf tiles...")
    leaf_grid, _ = assign_to_grid(primitives, LEAF_GRID)
    leaf_nodes  = {}
    mid_collect = {}
    written = 0

    for (col, row), idxs in leaf_grid.items():
        cell = [primitives[i] for i in idxs]
        glb  = build_glb(cell, tex_scale=TEX_SCALES["leaf"])
        if not glb:
            continue
        fname = f"tiles/leaf_{col}_{row}.glb"
        with open(os.path.join(output_dir, fname), "wb") as fh:
            fh.write(glb)
        written += 1
        leaf_nodes[(col, row)] = {
            "boundingVolume": {"sphere": sphere_bounds(cell)},
            "geometricError": 0.0,
            "content": {"uri": fname},
            "refine": "REPLACE",
        }
        mc = col * MID_GRID // LEAF_GRID
        mr = row * MID_GRID // LEAF_GRID
        mid_collect.setdefault((mc, mr), []).extend(cell)

    print(f"  Leaf tiles written: {written}")

    # ---- MID (4x4) ----
    print(f"Building {MID_GRID}x{MID_GRID} mid tiles...")
    mid_nodes    = {}
    root_collect = []

    for (mc, mr), cell in mid_collect.items():
        dec = []
        for p in cell:
            v, f, u, c = decimate(p["verts"], p["faces"], p["uvs"], LOD_RATIOS["mid"], p.get("colors"))
            dec.append({**p, "verts": v, "faces": f, "uvs": u, "colors": c})
        glb = build_glb(dec, tex_scale=TEX_SCALES["mid"])
        if not glb:
            continue
        fname = f"tiles/mid_{mc}_{mr}.glb"
        with open(os.path.join(output_dir, fname), "wb") as fh:
            fh.write(glb)
        written += 1

        children = []
        for c in range(mc * LEAF_GRID // MID_GRID, (mc+1) * LEAF_GRID // MID_GRID):
            for r in range(mr * LEAF_GRID // MID_GRID, (mr+1) * LEAF_GRID // MID_GRID):
                if (c, r) in leaf_nodes:
                    children.append(leaf_nodes[(c, r)])
        node = {
            "boundingVolume": {"sphere": sphere_bounds(cell)},
            "geometricError": 50.0,
            "content": {"uri": fname},
            "refine": "REPLACE",
        }
        if children:
            node["children"] = children
        mid_nodes[(mc, mr)] = node
        root_collect.extend(cell)

    print(f"  Mid tiles written: {len(mid_nodes)}")

    # ---- ROOT ----
    print("Building root tile...")
    dec_root = []
    for p in root_collect:
        v, f, u, c = decimate(p["verts"], p["faces"], p["uvs"], LOD_RATIOS["root"], p.get("colors"))
        dec_root.append({**p, "verts": v, "faces": f, "uvs": u, "colors": c})
    glb = build_glb(dec_root, tex_scale=TEX_SCALES["root"])
    if glb:
        with open(os.path.join(output_dir, "tiles/root.glb"), "wb") as fh:
            fh.write(glb)
        written += 1

    root_node = {
        "transform": transform,
        "boundingVolume": {"sphere": sphere_bounds(root_collect)},
        "geometricError": 500.0,
        "content": {"uri": "tiles/root.glb"},
        "refine": "REPLACE",
        "children": list(mid_nodes.values()),
    }

    tileset = {
        "asset": {"version": version},
        "geometricError": 1000.0,
        "root": root_node,
    }

    tpath = os.path.join(output_dir, "tileset.json")
    with open(tpath, "w") as fh:
        json.dump(tileset, fh, indent=2)

    print(f"\nTiling complete.")
    print(f"  Total tiles  : {written}")
    print(f"  tileset.json : {tpath}")
    return tpath


# ===========================================================================
# Post-process: gltf-transform compression
# ===========================================================================

def compress_tiles(output_dir):
    """Run gltf-transform optimize on all output GLBs (Draco + WebP)."""
    # Check gltf-transform is available
    try:
        subprocess.run(["gltf-transform", "--version"],
                       capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("\nWarning: gltf-transform not found on PATH.")
        print("  Install with: npm install -g @gltf-transform/cli")
        print("  Skipping compression step.")
        return False

    glb_files = glob.glob(os.path.join(output_dir, "tiles", "*.glb"))
    if not glb_files:
        print("  No GLB files found to compress.")
        return False

    print(f"\nCompressing {len(glb_files)} tiles with gltf-transform...")
    failed = 0
    for i, f in enumerate(glb_files, 1):
        name = os.path.basename(f)
        try:
            subprocess.run(
                ["gltf-transform", "optimize", f, f,
                 "--compress", "draco", "--texture-compress", "webp"],
                capture_output=True, check=True, timeout=120
            )
            print(f"  [{i}/{len(glb_files)}] {name} ✓")
        except subprocess.CalledProcessError as e:
            print(f"  [{i}/{len(glb_files)}] {name} FAILED: {e.stderr.decode().strip()}")
            failed += 1
        except subprocess.TimeoutExpired:
            print(f"  [{i}/{len(glb_files)}] {name} TIMEOUT")
            failed += 1

    if failed:
        print(f"\n  Compression done with {failed} failures out of {len(glb_files)} tiles.")
    else:
        print(f"\n  All {len(glb_files)} tiles compressed successfully.")
    return True


# ===========================================================================
# Entry point
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(
        description="GLB → positioned 3D Tiles pyramid (one-step pipeline)."
    )
    parser.add_argument("input",       help="Input GLB file")
    parser.add_argument("output",      help="Output directory")

    pos = parser.add_argument_group("positioning (pick one)")
    pos.add_argument("--tileset",  default=None,         help="Inherit transform from existing tileset.json")
    pos.add_argument("--lat",      type=float, default=None, help="Latitude in decimal degrees")
    pos.add_argument("--lon",      type=float, default=None, help="Longitude in decimal degrees")
    pos.add_argument("--bbox",     type=float, nargs=4,  help="min_lat min_lon max_lat max_lon (blosm bounding box)")

    elev = parser.add_argument_group("elevation")
    elev.add_argument("--ground",  type=float, default=None, help="Ground elevation in metres (auto-looked up if omitted)")
    elev.add_argument("--hag",     type=float, default=0.0,  help="Height above ground in metres (default: 0)")

    opt = parser.add_argument_group("options")
    opt.add_argument("--radius",     type=float, default=None, help="Override root bounding sphere radius (metres)")
    opt.add_argument("--centre",     action="store_true",      help="Translate model centroid to origin before tiling (fixes offset models)")
    opt.add_argument("--ground-snap",action="store_true",      help="Snap model base to Z=0 so it sits on the ground plane (fixes models appearing underground)")
    opt.add_argument("--compress",   action="store_true",      help="Compress output tiles with gltf-transform (Draco + WebP)")
    opt.add_argument("--height-ramp",action="store_true",      help="Bake a Blender-style height gradient as a texture + UVs (ATAK-friendly) before tiling")
    opt.add_argument("--zmin",       type=float, default=None, help="Override min Z for --height-ramp (default: auto from model)")
    opt.add_argument("--zmax",       type=float, default=None, help="Override max Z for --height-ramp (default: auto from model)")
    opt.add_argument("--invert-ramp",action="store_true",      help="Invert the height ramp (high=blue, low=red)")
    opt.add_argument("--version",  type=str,   default="1.1", help="3D Tiles version (default: 1.1)")

    args = parser.parse_args()

    input_glb  = os.path.abspath(args.input)
    output_dir = os.path.abspath(args.output)

    if not os.path.exists(input_glb):
        print(f"Error: {input_glb} not found")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # ----------------------------------------------------------------
    # Step 1: Resolve position (from TilesBlosm.py logic)
    # ----------------------------------------------------------------
    print("=" * 60)
    print("STEP 1: Positioning")
    print("=" * 60)

    transform      = None
    override_radius = args.radius

    if args.tileset:
        src_path = os.path.abspath(args.tileset)
        if not os.path.exists(src_path):
            print(f"Error: {src_path} not found"); sys.exit(1)
        with open(src_path) as fh:
            src = json.load(fh)
        transform = src["root"].get("transform")
        bv = src["root"].get("boundingVolume", {})
        if "sphere" in bv and override_radius is None:
            override_radius = bv["sphere"][3]
        print(f"  Inherited transform from: {src_path}")
        if override_radius:
            print(f"  Inherited radius: {override_radius} m")

    if transform is None:
        if args.bbox:
            min_lat, min_lon, max_lat, max_lon = args.bbox
            lat, lon, auto_radius = bbox_to_centre(min_lat, min_lon, max_lat, max_lon)
            if override_radius is None:
                override_radius = auto_radius
            print(f"  BBox centre: {lat:.6f}, {lon:.6f}")
        elif args.lat is not None and args.lon is not None:
            lat, lon = args.lat, args.lon
        else:
            print("Error: provide --tileset, --lat/--lon, or --bbox")
            sys.exit(1)

        if args.ground is not None:
            ground, source = args.ground, "manual"
        else:
            print(f"  Looking up elevation for {lat:.6f}, {lon:.6f}...")
            ground, source = lookup_elevation(lat, lon)

        ellipsoid_height = ground + args.hag
        transform = ecef_transform(lat, lon, ellipsoid_height)

        print(f"  Location:         {lat:.6f}, {lon:.6f}")
        print(f"  Ground elevation: {ground:.1f} m ({source})")
        print(f"  Height above ground: {args.hag} m")
        print(f"  Ellipsoid height: {ellipsoid_height:.1f} m")

    # ----------------------------------------------------------------
    # Step 2: Centre (optional) + Load and tile
    # ----------------------------------------------------------------
    print()
    print("=" * 60)
    print("STEP 2: Loading and tiling")
    print("=" * 60)

    glb_to_load = input_glb
    if args.centre:
        print("Centring model...")
        centred_path = os.path.join(output_dir, "_centred_input.glb")
        glb_to_load = centre_glb(input_glb, centred_path)
        print()

    if args.ground_snap:
        print("Ground snapping model...")
        snapped_path = os.path.join(output_dir, "_snapped_input.glb")
        glb_to_load = ground_snap_glb(glb_to_load, snapped_path)
        print()

    primitives = load_glb(glb_to_load)

    if args.height_ramp:
        # Warn if the input already carries a base-colour texture — let the user decide.
        if any(p.get("tex_bytes") is not None for p in primitives):
            print()
            print("  WARNING: input GLB already has a base-colour texture.")
            print("  --height-ramp replaces the model's UVs and texture with a height")
            print("  gradient, which would discard the existing texture.")
            print("  Re-export without the texture, or drop --height-ramp. Aborting.")
            sys.exit(1)
        print("Baking height ramp...")
        bake_height_ramp(primitives, zmin=args.zmin, zmax=args.zmax, invert=args.invert_ramp)
        print()

    tpath = tile_glb(primitives, output_dir, transform, args.version)

    # Apply radius override if set
    if override_radius is not None:
        with open(tpath) as fh:
            ts = json.load(fh)
        ts["root"]["boundingVolume"]["sphere"][3] = override_radius
        with open(tpath, "w") as fh:
            json.dump(ts, fh, indent=2)
        print(f"  Root bounding sphere radius set to: {override_radius} m")

    # ----------------------------------------------------------------
    # Step 3: Compress (optional)
    # ----------------------------------------------------------------
    if args.compress:
        print()
        print("=" * 60)
        print("STEP 3: Compressing tiles")
        print("=" * 60)
        compress_tiles(output_dir)

    print()
    print("=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Output: {output_dir}")
    print(f"  Serve with: python3 -m http.server 8080 --directory {output_dir}")


if __name__ == "__main__":
    main()