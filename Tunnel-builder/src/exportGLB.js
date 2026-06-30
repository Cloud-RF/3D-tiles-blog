import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { getSectionPieces } from './sectionGeometry';

// ── Scene assembly ───────────────────────────────────────────────────────────

function buildExportGroup(sections) {
  const group = new THREE.Group();
  group.name = 'TunnelModel';

  for (const section of sections) {
    const sectionGroup = new THREE.Group();
    sectionGroup.name = `${section.type}_${section.id}`;
    sectionGroup.position.set(...section.position);
    sectionGroup.rotation.set(...section.rotation);

    const pieces = getSectionPieces(section.type);
    // Keep each box as its own Mesh — merging creates non-manifold topology that
    // causes Draco's Edgebreaker algorithm to loop after weld() runs internally.
    pieces.forEach((p, i) => {
      const geom = new THREE.BoxGeometry(...p.size);
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a6f95, roughness: 0.7, metalness: 0 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(...p.position);
      mesh.rotation.set(...p.rotation);
      mesh.name = `piece_${i}`;
      sectionGroup.add(mesh);
    });

    group.add(sectionGroup);
  }

  return group;
}

// ── Main export entry point ──────────────────────────────────────────────────

export async function exportToGLB(sections, onStatus) {
  if (!sections.length) throw new Error('Nothing to export — place at least one section first.');

  onStatus('Building geometry…');
  const group = buildExportGroup(sections);

  onStatus('Exporting GLB…');
  const rawGlb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(group, resolve, reject, { binary: true });
  });

  group.traverse((obj) => {
    if (obj.isMesh) { obj.geometry.dispose(); obj.material.dispose(); }
  });

  // Send the uncompressed GLB to the dev-server endpoint, which runs Draco
  // compression in Node and returns the compressed bytes. This avoids
  // freezing the browser tab on the asm.js encoder.
  onStatus('Compressing on server…');
  const resp = await fetch('/api/draco-compress', {
    method: 'POST',
    headers: { 'Content-Type': 'model/gltf-binary' },
    body: rawGlb,
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Server compression failed: ${msg}`);
  }
  const compressed = new Uint8Array(await resp.arrayBuffer());

  onStatus('Done');
  return compressed;
}

export function downloadBuffer(data, filename) {
  const blob = new Blob([data], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
