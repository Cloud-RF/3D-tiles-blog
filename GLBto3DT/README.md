# GLB to 3D Tiles

Combines TilesBlosm.py (positioning) + glb_to_3dtiles.py (tiling) into a single pipeline. Optionally compresses output tiles with gltf-transform.

Handles Draco-compressed input GLBs and WebP textures automatically.

## Requirements

    pip install pygltflib trimesh numpy Pillow

## Usage
Lat/lon (elevation looked up automatically)

    python3 GLB-to-3DT.py model.glb ./output --lat 60.162 --lon 24.945

Blosm bounding box

    python3 GLB-to-3DT.py model.glb ./output --bbox 60.1553 24.9415 60.1568 24.9469

Manual ground elevation + height above ground

    python3 GLB-to-3DT.py model.glb ./output --lat 45.218 --lon -112.125 --ground 1800 --hag 5

Inherit position from existing tileset.json

    python3 GLB-to-3DT.py model.glb ./output --tileset tileset.json

With gltf-transform compression (requires gltf-transform on PATH)

    python3 GLB-to-3DT.py model.glb ./output --lat 60.162 --lon 24.945 --compress

Centre model at origin before tiling (fixes offset/misplaced models)

    python3 GLB-to-3DT.py model.glb ./output --lat 51.5237 --lon -0.0756 --centre

Snap model base to Z=0 so it sits on the ground plane (fixes models appearing underground)

    python3 GLB-to-3DT.py model.glb ./output --lat 51.5237 --lon -0.0756 --ground-snap

Optional: pip install DracoPy  (for Draco-compressed input GLBs)

Optional: npm install -g @gltf-transform/cli  (for --compress)