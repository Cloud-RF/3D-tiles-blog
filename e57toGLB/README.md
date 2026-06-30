E57 / LAZ → Mesh GLB converter (via pye57/PDAL + Open3D Poisson)
=================================================================
Converts an E57 (or LAZ/LAS) point cloud to a high-quality meshed GLB
using Open3D's Poisson surface reconstruction. No Blender required.

## Usage
    python e57_to_mesh_glb.py input.e57 output.glb [options]
    python e57_to_mesh_glb.py input.laz output.glb [options]

## Options
    --max-points  INT    Downsample to this many points max     (default: 10000000)
    --depth       INT    Poisson octree depth; higher = more
                        detail but slower and more RAM         (default: 10)
    --scale       FLOAT  How far mesh extends beyond points     (default: 1.1)
    --density-pct FLOAT  Trim low-confidence faces: remove the
                        bottom N% by density                   (default: 5.0)
    --normals-nn  INT    Neighbours used for normal estimation  (default: 30)
    --no-colour          Skip vertex colours (faster export)

## Requirements
    pip install pye57 open3d numpy

## How it works
    1. pye57 (E57) or PDAL (LAZ/LAS) reads the point cloud.
    2. Points are centred at origin and optionally downsampled.
    3. Open3D estimates per-point normals.
    4. Poisson surface reconstruction builds a watertight mesh.
    5. Low-density boundary faces are trimmed.
    6. Vertex colours are transferred from the point cloud.
    7. Mesh is exported as GLB via Open3D.

## Depth guide (mm-scale data)
    8  = fast draft, coarse
    9  = good balance
    10 = high detail            (default)
    11 = very high, needs 16GB+
    12 = maximum, needs 32GB+

## Example use

    python e57_to_glb.py input.e57 output.glb --max-points 500000 --depth 8 --density-pct 10 