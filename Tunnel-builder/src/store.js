import { create } from 'zustand';
import * as THREE from 'three';
import { getConnectors } from './tunnelSections';

let nextId = 1;

export const useStore = create((set, get) => ({
  sections: [],
  selectedId: null,

  setSelected: (id) => set({ selectedId: id }),

  addSection: (type, position, rotation) => {
    const id = nextId++;
    set((s) => ({ sections: [...s.sections, { id, type, position: [...position], rotation: [...rotation] }] }));
    return id;
  },

  updateSection: (id, updates) => {
    set((s) => ({
      sections: s.sections.map((x) => (x.id === id ? { ...x, ...updates } : x)),
    }));
  },

  removeSection: (id) => {
    set((s) => ({
      sections: s.sections.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  // Replace the whole scene (used by load/import). Resets the id counter so
  // future inserts don't collide with loaded ids.
  loadSections: (sections) => {
    const clean = (sections || []).map((s) => ({
      id: s.id,
      type: s.type,
      position: [...s.position],
      rotation: [...s.rotation],
    }));
    const maxId = clean.reduce((m, s) => Math.max(m, s.id || 0), 0);
    nextId = maxId + 1;
    set({ sections: clean, selectedId: null });
  },

  clearAll: () => {
    nextId = 1;
    set({ sections: [], selectedId: null });
  },

  findSnap: (type, worldPos, excludeId = null) => {
    const SNAP_DIST = 2.5;
    const sections = get().sections;
    const newConnectors = getConnectors(type);

    let best = null;
    let bestDist = SNAP_DIST;

    for (const section of sections) {
      if (section.id === excludeId) continue;
      const sPos = new THREE.Vector3(...section.position);
      const sQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...section.rotation));
      const existingConnectors = getConnectors(section.type);

      for (const ec of existingConnectors) {
        const ecWorld = new THREE.Vector3(...ec.position).applyQuaternion(sQuat).add(sPos);
        const ecDir = new THREE.Vector3(...ec.direction).applyQuaternion(sQuat).normalize();

        for (const nc of newConnectors) {
          const ncDir = new THREE.Vector3(...nc.direction).normalize();
          const targetDir = ecDir.clone().negate();
          const requiredQuat = new THREE.Quaternion().setFromUnitVectors(ncDir, targetDir);
          const ncOffset = new THREE.Vector3(...nc.position).applyQuaternion(requiredQuat);
          const newPos = ecWorld.clone().sub(ncOffset);

          const dist = newPos.distanceTo(worldPos);
          if (dist < bestDist) {
            bestDist = dist;
            const euler = new THREE.Euler().setFromQuaternion(requiredQuat);
            best = {
              position: [newPos.x, newPos.y, newPos.z],
              rotation: [euler.x, euler.y, euler.z],
            };
          }
        }
      }
    }

    return best;
  },

  // Snap an existing section so its nearest connector mates with the nearest
  // connector on any other section. Returns true if a snap was applied.
  snapSectionToNearest: (id) => {
    const sections = get().sections;
    const self = sections.find((s) => s.id === id);
    if (!self) return false;
    const others = sections.filter((s) => s.id !== id);
    if (!others.length) return false;

    const selfQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...self.rotation));
    const selfPos = new THREE.Vector3(...self.position);
    const selfConnectors = getConnectors(self.type).map((c) => ({
      local: c,
      worldPos: new THREE.Vector3(...c.position).applyQuaternion(selfQuat).add(selfPos),
    }));

    let best = null;
    let bestDist = Infinity;

    for (const other of others) {
      const oQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...other.rotation));
      const oPos = new THREE.Vector3(...other.position);
      for (const oc of getConnectors(other.type)) {
        const ocWorld = new THREE.Vector3(...oc.position).applyQuaternion(oQuat).add(oPos);
        const ocDir = new THREE.Vector3(...oc.direction).applyQuaternion(oQuat).normalize();

        for (const sc of selfConnectors) {
          const dist = sc.worldPos.distanceTo(ocWorld);
          if (dist >= bestDist) continue;

          // Build the rotation/position that places self so sc lands on ocWorld
          // and sc's direction points opposite to ocDir.
          const scLocalDir = new THREE.Vector3(...sc.local.direction).normalize();
          const requiredQuat = new THREE.Quaternion().setFromUnitVectors(scLocalDir, ocDir.clone().negate());
          const scOffset = new THREE.Vector3(...sc.local.position).applyQuaternion(requiredQuat);
          const newPos = ocWorld.clone().sub(scOffset);
          const euler = new THREE.Euler().setFromQuaternion(requiredQuat);

          bestDist = dist;
          best = {
            position: [newPos.x, newPos.y, newPos.z],
            rotation: [euler.x, euler.y, euler.z],
          };
        }
      }
    }

    if (!best) return false;
    set((s) => ({
      sections: s.sections.map((x) => (x.id === id ? { ...x, ...best } : x)),
    }));
    return true;
  },
}));
