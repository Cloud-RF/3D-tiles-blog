// Geometry for each tunnel section type, as a list of boxes in local space.
// One source of truth used by both the 3D scene (TunnelSection.jsx) and the
// GLB exporter (exportGLB.js).

import { SECTION_TYPES, TUNNEL_WIDTH, TUNNEL_HEIGHT, TUNNEL_LENGTH } from './tunnelSections';

const W = TUNNEL_WIDTH;
const H = TUNNEL_HEIGHT;
const L = TUNNEL_LENGTH;
const T = 0.07; // wall thickness
const FY = -H / 2 + T / 2; // floor centre Y
const CY =  H / 2 - T / 2; // ceiling centre Y

// ── Straight ────────────────────────────────────────────────────────────────
function straightPieces() {
  return [
    { size: [W, T, L], position: [0, FY, 0],           rotation: [0, 0, 0] }, // floor
    { size: [W, T, L], position: [0, CY, 0],           rotation: [0, 0, 0] }, // ceiling
    { size: [T, H, L], position: [-W/2 + T/2, 0, 0],   rotation: [0, 0, 0] }, // left wall
    { size: [T, H, L], position: [ W/2 - T/2, 0, 0],   rotation: [0, 0, 0] }, // right wall
  ];
}

// ── 4-way junction (cross) ──────────────────────────────────────────────────
function junctionPieces() {
  const seg = (L - W) / 2;            // arm length beyond the centre square
  const arm = W / 2 + seg / 2;        // distance from origin to arm-segment centre
  return [
    // Floor
    { size: [W, T, W],   position: [0, FY, 0],     rotation: [0,0,0] },
    { size: [W, T, seg], position: [0, FY, -arm],  rotation: [0,0,0] },
    { size: [W, T, seg], position: [0, FY,  arm],  rotation: [0,0,0] },
    { size: [seg, T, W], position: [-arm, FY, 0],  rotation: [0,0,0] },
    { size: [seg, T, W], position: [ arm, FY, 0],  rotation: [0,0,0] },
    // Ceiling
    { size: [W, T, W],   position: [0, CY, 0],     rotation: [0,0,0] },
    { size: [W, T, seg], position: [0, CY, -arm],  rotation: [0,0,0] },
    { size: [W, T, seg], position: [0, CY,  arm],  rotation: [0,0,0] },
    { size: [seg, T, W], position: [-arm, CY, 0],  rotation: [0,0,0] },
    { size: [seg, T, W], position: [ arm, CY, 0],  rotation: [0,0,0] },
    // Z-arm walls
    { size: [T, H, seg], position: [-W/2 + T/2, 0, -arm], rotation: [0,0,0] },
    { size: [T, H, seg], position: [-W/2 + T/2, 0,  arm], rotation: [0,0,0] },
    { size: [T, H, seg], position: [ W/2 - T/2, 0, -arm], rotation: [0,0,0] },
    { size: [T, H, seg], position: [ W/2 - T/2, 0,  arm], rotation: [0,0,0] },
    // X-arm walls
    { size: [seg, H, T], position: [-arm, 0, -W/2 + T/2], rotation: [0,0,0] },
    { size: [seg, H, T], position: [ arm, 0, -W/2 + T/2], rotation: [0,0,0] },
    { size: [seg, H, T], position: [-arm, 0,  W/2 - T/2], rotation: [0,0,0] },
    { size: [seg, H, T], position: [ arm, 0,  W/2 - T/2], rotation: [0,0,0] },
  ];
}

// ── Square 90° corner (connectors at -z and +x) ─────────────────────────────
function cornerPieces() {
  const seg = (L - W) / 2;
  const arm = W / 2 + seg / 2;
  return [
    // Floor: centre + z- arm + x+ arm
    { size: [W,   T, W],   position: [0,    FY,  0],    rotation: [0,0,0] },
    { size: [W,   T, seg], position: [0,    FY, -arm],  rotation: [0,0,0] },
    { size: [seg, T, W],   position: [arm,  FY,  0],    rotation: [0,0,0] },
    // Ceiling
    { size: [W,   T, W],   position: [0,    CY,  0],    rotation: [0,0,0] },
    { size: [W,   T, seg], position: [0,    CY, -arm],  rotation: [0,0,0] },
    { size: [seg, T, W],   position: [arm,  CY,  0],    rotation: [0,0,0] },
    // Outer L walls (south-west outer boundary)
    { size: [T, H, seg], position: [-W/2 + T/2, 0, -arm],     rotation: [0,0,0] }, // z- arm left wall
    { size: [T, H, W],   position: [-W/2 + T/2, 0,  0],       rotation: [0,0,0] }, // centre left wall
    { size: [W, H, T],   position: [ 0,         0,  W/2 - T/2], rotation: [0,0,0] }, // centre back wall
    { size: [seg, H, T], position: [ arm,       0,  W/2 - T/2], rotation: [0,0,0] }, // x+ arm back wall
    // Inner L walls (the inside of the L turn). The z- arm right wall is
    // extended by T southward so it overlaps the x+ arm front wall at the
    // inside corner — otherwise the two walls would only touch at a single
    // point and leave a T×T uncovered square exposing the outside world.
    { size: [T, H, seg + T], position: [ W/2 - T/2, 0, -arm + T/2], rotation: [0,0,0] }, // z- arm right wall (extended)
    { size: [seg, H, T],     position: [ arm,       0, -W/2 + T/2], rotation: [0,0,0] }, // x+ arm front wall
  ];
}

// ── Generic swept-path helper ───────────────────────────────────────────────
// samples = [{ pos: [x,y,z], angle: yawRadians, length: arcLen }, ...]
// Produces 4 boxes per sample (floor, ceiling, two side walls) oriented along
// the path tangent.
function pathPieces(samples) {
  const pieces = [];
  for (const { pos, angle, length: s } of samples) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    // Local (lx, ly, lz) -> world (Three.js Y-rotation by angle)
    const toWorld = (lx, ly, lz) => [
      pos[0] + cosA * lx + sinA * lz,
      pos[1] + ly,
      pos[2] - sinA * lx + cosA * lz,
    ];
    const localBoxes = [
      { local: [0, FY, 0],            size: [W, T, s] }, // floor
      { local: [0, CY, 0],            size: [W, T, s] }, // ceiling
      { local: [ W/2 - T/2, 0, 0],    size: [T, H, s] }, // right-of-travel wall
      { local: [-W/2 + T/2, 0, 0],    size: [T, H, s] }, // left-of-travel wall
    ];
    for (const { local, size } of localBoxes) {
      pieces.push({
        size,
        position: toWorld(local[0], local[1], local[2]),
        rotation: [0, angle, 0],
      });
    }
  }
  return pieces;
}

// ── Round 90° corner ────────────────────────────────────────────────────────
function cornerRoundPieces() {
  const N = 16;               // segments along the arc
  const R = L / 2;            // centreline radius = 2m
  const cx = L / 2, cz = -L / 2; // arc centre at (+2, 0, -2)
  const sweep = Math.PI / 2;
  const dTheta = sweep / N;

  // Place boxes at the *chord* midpoint (not the arc midpoint) so their flat
  // ends naturally land on the boundary radials, and extend each box's length
  // by 2·overlap so adjacent boxes overlap on the convex side of the kink —
  // otherwise there's a visible wedge gap of W/2·dTheta ≈ several cm wide.
  const chord = 2 * R * Math.sin(dTheta / 2);
  const overlap = (W / 2) * Math.tan(dTheta / 2);
  const sLen = chord + 2 * overlap;
  const rMid = R * Math.cos(dTheta / 2);  // distance from arc centre to chord midpoint

  const samples = [];
  for (let i = 0; i < N; i++) {
    // theta goes from π (at connector "front" (0,0,-2)) down to π/2 (at "right" (2,0,0))
    const theta = Math.PI - dTheta * (i + 0.5);
    const pos = [cx + rMid * Math.cos(theta), 0, cz + rMid * Math.sin(theta)];
    // Tangent direction for decreasing θ: (sin θ, -cos θ)
    const tx = Math.sin(theta);
    const tz = -Math.cos(theta);
    const angle = Math.atan2(tx, tz);
    samples.push({ pos, angle, length: sLen });
  }
  return pathPieces(samples);
}

// ── S-curve (lane shift) ────────────────────────────────────────────────────
function sPiecePieces() {
  const N = 20;
  const P0 = [-W/2, 0, -L/2];
  const P1 = [-W/2, 0, -L/2 + L/3]; // tangent at start = +z
  const P2 = [ W/2, 0,  L/2 - L/3]; // tangent at end   = +z
  const P3 = [ W/2, 0,  L/2];

  const B = (t) => {
    const u = 1 - t;
    return [
      u*u*u*P0[0] + 3*u*u*t*P1[0] + 3*u*t*t*P2[0] + t*t*t*P3[0],
      0,
      u*u*u*P0[2] + 3*u*u*t*P1[2] + 3*u*t*t*P2[2] + t*t*t*P3[2],
    ];
  };

  // Sample N+1 boundary points along the curve, then build each box as the
  // chord between successive points with length extended so neighbours overlap.
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(B(i / N));

  const chordLens = [];
  const chordAngles = [];
  for (let i = 0; i < N; i++) {
    const dx = pts[i+1][0] - pts[i][0];
    const dz = pts[i+1][2] - pts[i][2];
    chordLens.push(Math.hypot(dx, dz));
    chordAngles.push(Math.atan2(dx, dz));
  }

  const samples = [];
  for (let i = 0; i < N; i++) {
    const mid = [
      (pts[i][0] + pts[i+1][0]) / 2,
      0,
      (pts[i][2] + pts[i+1][2]) / 2,
    ];
    // Kink angle to back/front neighbour (0 at the ends).
    const dBack = i > 0      ? Math.abs(chordAngles[i] - chordAngles[i-1]) : 0;
    const dFwd  = i < N - 1  ? Math.abs(chordAngles[i+1] - chordAngles[i]) : 0;
    const overlap = (W / 2) * Math.tan(Math.max(dBack, dFwd) / 2);
    samples.push({ pos: mid, angle: chordAngles[i], length: chordLens[i] + 2 * overlap });
  }
  return pathPieces(samples);
}

// ── Public API ──────────────────────────────────────────────────────────────
export function getSectionPieces(type) {
  switch (type) {
    case SECTION_TYPES.STRAIGHT:     return straightPieces();
    case SECTION_TYPES.JUNCTION:     return junctionPieces();
    case SECTION_TYPES.CORNER:       return cornerPieces();
    case SECTION_TYPES.CORNER_ROUND: return cornerRoundPieces();
    case SECTION_TYPES.S_PIECE:      return sPiecePieces();
    default: return [];
  }
}

// Approximate bounding box (used for drag-preview ghost & selection wireframe).
export function getBBox(type) {
  switch (type) {
    case SECTION_TYPES.STRAIGHT: return [W, H, L];
    case SECTION_TYPES.S_PIECE:  return [2 * W, H, L];
    default:                     return [L, H, L]; // junction, corner, corner_round
  }
}
