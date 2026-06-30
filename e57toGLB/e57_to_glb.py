#!/usr/bin/env python3
"""
E57 / LAZ → Mesh GLB converter (via pye57/PDAL + Open3D Poisson)
=================================================================
Converts an E57 (or LAZ/LAS) point cloud to a high-quality meshed GLB
using Open3D's Poisson surface reconstruction. No Blender required.

Usage:
    python e57_to_mesh_glb.py input.e57 output.glb [options]
    python e57_to_mesh_glb.py input.laz output.glb [options]

Options:
    --max-points  INT    Downsample to this many points max     (default: 10000000)
    --depth       INT    Poisson octree depth; higher = more
                         detail but slower and more RAM         (default: 10)
    --scale       FLOAT  How far mesh extends beyond points     (default: 1.1)
    --density-pct FLOAT  Trim low-confidence faces: remove the
                         bottom N% by density                   (default: 5.0)
    --normals-nn  INT    Neighbours used for normal estimation  (default: 30)
    --no-colour          Skip vertex colours (faster export)

Requirements:
    pip install pye57 open3d numpy

How it works:
    1. pye57 (E57) or PDAL (LAZ/LAS) reads the point cloud.
    2. Points are centred at origin and optionally downsampled.
    3. Open3D estimates per-point normals.
    4. Poisson surface reconstruction builds a watertight mesh.
    5. Low-density boundary faces are trimmed.
    6. Vertex colours are transferred from the point cloud.
    7. Mesh is exported as GLB via Open3D.

Depth guide (mm-scale data):
    8  = fast draft, coarse
    9  = good balance
    10 = high detail            (default)
    11 = very high, needs 16GB+
    12 = maximum, needs 32GB+
"""

import sys
import os
import json
import argparse
import numpy as np


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="Convert E57/LAZ point cloud to GLB via Open3D Poisson reconstruction"
    )
    p.add_argument("input",  help="Input .e57 / .laz / .las file")
    p.add_argument("output", help="Output .glb file")
    p.add_argument("--max-points",  type=int,   default=10_000_000,
                   help="Downsample to this many points (default 10 000 000)")
    p.add_argument("--depth",       type=int,   default=10,
                   help="Poisson octree depth (default 10; higher = more detail)")
    p.add_argument("--scale",       type=float, default=1.1,
                   help="Poisson scale — mesh extent beyond points (default 1.1)")
    p.add_argument("--density-pct", type=float, default=5.0,
                   help="Remove bottom N%% of faces by density (default 5.0)")
    p.add_argument("--normals-nn",  type=int,   default=30,
                   help="Neighbours for normal estimation (default 30)")
    p.add_argument("--no-colour",   action="store_true",
                   help="Skip vertex colour transfer")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Step 1 - read point cloud
# ---------------------------------------------------------------------------

def height_colours(xyz: np.ndarray) -> np.ndarray:
    """Green (low) -> red (high) gradient, returned as float32 0-1 for Open3D."""
    z_range = xyz[:, 2].max() - xyz[:, 2].min()
    z_norm = (xyz[:, 2] - xyz[:, 2].min()) / (z_range + 1e-9)
    return np.column_stack([
        z_norm.astype(np.float32),
        (1 - z_norm).astype(np.float32) * 0.7,
        np.zeros(len(xyz), dtype=np.float32),
    ])


def read_e57(input_file: str, max_points: int):
    try:
        import pye57
    except ImportError:
        sys.exit("Missing dependency: pip install pye57")

    print(f"[1/3] Reading {input_file}  (reader: pye57) ...")
    e57 = pye57.E57(input_file)
    scan_count = e57.scan_count
    print(f"    {scan_count} scan(s) found.")

    xyz_parts = []
    rgb_parts = []
    has_colour = None

    for i in range(scan_count):
        print(f"    Reading scan {i + 1}/{scan_count} ...")
        data = e57.read_scan(i, ignore_missing_fields=True)

        x = data["cartesianX"].astype(np.float32)
        y = data["cartesianY"].astype(np.float32)
        z = data["cartesianZ"].astype(np.float32)

        valid = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
        x, y, z = x[valid], y[valid], z[valid]
        xyz_parts.append(np.column_stack([x, y, z]))

        if has_colour is not False:
            try:
                r = data["colorRed"][valid].astype(np.float32)
                g = data["colorGreen"][valid].astype(np.float32)
                b = data["colorBlue"][valid].astype(np.float32)
                max_val = max(r.max(), g.max(), b.max())
                scale = 1.0 / 255.0 if max_val > 1.0 else 1.0
                rgb_parts.append(np.column_stack([
                    np.clip(r * scale, 0, 1).astype(np.float32),
                    np.clip(g * scale, 0, 1).astype(np.float32),
                    np.clip(b * scale, 0, 1).astype(np.float32),
                ]))
                has_colour = True
            except KeyError:
                has_colour = False

    xyz = np.concatenate(xyz_parts, axis=0)
    print(f"    {len(xyz):,} valid points loaded.")
    xyz -= xyz.mean(axis=0)

    if has_colour and rgb_parts:
        colours = np.concatenate(rgb_parts, axis=0)
        print("    Using RGB colours from point cloud.")
    else:
        print("    No RGB found - using height-based colours.")
        colours = height_colours(xyz)

    if len(xyz) > max_points:
        print(f"    Downsampling from {len(xyz):,} -> {max_points:,} points ...")
        idx = np.random.choice(len(xyz), max_points, replace=False)
        xyz     = xyz[idx]
        colours = colours[idx]

    print(f"    Final point count: {len(xyz):,}")
    return xyz, colours


def read_laz(input_file: str, max_points: int):
    try:
        import pdal
    except ImportError:
        sys.exit("Missing dependency: pip install pdal")

    print(f"[1/3] Reading {input_file}  (reader: pdal) ...")
    pipeline = pdal.Pipeline(json.dumps({
        "pipeline": [
            {"type": "readers.las", "filename": input_file},
            {"type": "filters.range", "limits": "Classification![7:7]"}
        ]
    }))
    pipeline.execute()

    arrays = pipeline.arrays
    if not arrays or len(arrays[0]) == 0:
        sys.exit("No points read from file.")

    points = arrays[0]
    print(f"    {len(points):,} points loaded.")

    xyz = np.column_stack([
        points["X"].astype(np.float32),
        points["Y"].astype(np.float32),
        points["Z"].astype(np.float32),
    ])
    xyz -= xyz.mean(axis=0)

    try:
        colours = np.column_stack([
            (points["Red"]   / 65535.0).astype(np.float32),
            (points["Green"] / 65535.0).astype(np.float32),
            (points["Blue"]  / 65535.0).astype(np.float32),
        ])
        print("    Using RGB colours from point cloud.")
    except (ValueError, KeyError):
        print("    No RGB found - using height-based colours.")
        colours = height_colours(xyz)

    if len(xyz) > max_points:
        print(f"    Downsampling from {len(xyz):,} -> {max_points:,} points ...")
        idx = np.random.choice(len(xyz), max_points, replace=False)
        xyz     = xyz[idx]
        colours = colours[idx]

    print(f"    Final point count: {len(xyz):,}")
    return xyz, colours


def read_pointcloud(input_file: str, max_points: int):
    ext = os.path.splitext(input_file)[1].lower()
    if ext == ".e57":
        return read_e57(input_file, max_points)
    elif ext in (".laz", ".las"):
        return read_laz(input_file, max_points)
    else:
        sys.exit(f"Unsupported file extension '{ext}'. Expected .e57, .laz, or .las")


# ---------------------------------------------------------------------------
# Step 2 - Open3D Poisson reconstruction
# ---------------------------------------------------------------------------

def build_mesh(xyz: np.ndarray, colours: np.ndarray, args):
    try:
        import open3d as o3d
    except ImportError:
        sys.exit("Missing dependency: pip install open3d")

    print("[2/3] Building mesh with Open3D Poisson reconstruction ...")

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(xyz.astype(np.float64))
    if not args.no_colour:
        pcd.colors = o3d.utility.Vector3dVector(colours.astype(np.float64))

    # Estimate normals
    print(f"    Estimating normals (nn={args.normals_nn}) ...")
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamKNN(knn=args.normals_nn)
    )
    pcd.orient_normals_consistent_tangent_plane(k=args.normals_nn)

    # Poisson reconstruction
    print(f"    Running Poisson (depth={args.depth}, scale={args.scale}) ...")
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd,
        depth=args.depth,
        scale=args.scale,
        linear_fit=True,
    )

    # Trim low-density boundary faces
    if args.density_pct > 0:
        densities = np.asarray(densities)
        cutoff = np.percentile(densities, args.density_pct)
        keep = densities > cutoff
        mesh.remove_vertices_by_mask(~keep)
        print(f"    Trimmed bottom {args.density_pct}% low-density faces.")

    mesh.compute_vertex_normals()

    verts = len(mesh.vertices)
    faces = len(mesh.triangles)
    print(f"    Mesh: {verts:,} vertices / {faces:,} triangles")

    if verts == 0:
        sys.exit("Mesh is empty - try increasing --depth or reducing --density-pct")

    return mesh


# ---------------------------------------------------------------------------
# Step 3 - export GLB
# ---------------------------------------------------------------------------

def export_glb(mesh, output_path: str):
    try:
        import trimesh
        import numpy as np
    except ImportError:
        sys.exit("Missing dependency: pip install trimesh")

    print(f"[3/3] Exporting GLB -> {output_path} ...")

    if not output_path.lower().endswith(".glb"):
        output_path = os.path.splitext(output_path)[0] + ".glb"

    verts    = np.asarray(mesh.vertices)
    faces    = np.asarray(mesh.triangles)
    normals  = np.asarray(mesh.vertex_normals) if mesh.has_vertex_normals() else None
    colours  = np.asarray(mesh.vertex_colors)  if mesh.has_vertex_colors()  else None

    tm = trimesh.Trimesh(
        vertices=verts,
        faces=faces,
        vertex_normals=normals,
        process=False,
    )

    if colours is not None and len(colours) == len(verts):
        # trimesh expects uint8 RGBA
        rgba = np.ones((len(verts), 4), dtype=np.uint8) * 255
        rgba[:, :3] = (np.clip(colours, 0, 1) * 255).astype(np.uint8)
        tm.visual = trimesh.visual.ColorVisuals(mesh=tm, vertex_colors=rgba)

    # Export with UNSIGNED_INT (32-bit) indices — handles meshes > 65535 verts
    glb_bytes = trimesh.exchange.gltf.export_glb(tm, unitize_normals=False)
    with open(output_path, "wb") as f:
        f.write(glb_bytes)

    return output_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    if not os.path.exists(args.input):
        sys.exit(f"Input file not found: {args.input}")

    xyz, colours = read_pointcloud(args.input, args.max_points)
    mesh = build_mesh(xyz, colours, args)
    out = export_glb(mesh, args.output)

    size_mb = os.path.getsize(out) / 1e6
    print(f"\nDone!  {out}  ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
