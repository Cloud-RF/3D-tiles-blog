import { useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useStore } from '../store';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const OFFSET = 3.2; // world units from section center to arrow base

const ARROW_DEFS = [
  { key: 'px', axis: 'x', dir: [1, 0, 0],  rotation: [0, 0, -Math.PI / 2], color: '#ff4455', hover: '#ff7788' },
  { key: 'nx', axis: 'x', dir: [-1, 0, 0], rotation: [0, 0,  Math.PI / 2], color: '#ff4455', hover: '#ff7788' },
  { key: 'pz', axis: 'z', dir: [0, 0, 1],  rotation: [ Math.PI / 2, 0, 0], color: '#4488ff', hover: '#77aaff' },
  { key: 'nz', axis: 'z', dir: [0, 0, -1], rotation: [-Math.PI / 2, 0, 0], color: '#4488ff', hover: '#77aaff' },
];

function Arrow({ def, sectionId, sectionPos, controlsRef }) {
  const { camera, raycaster, gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const lastHit = useRef(null);

  const pos = [
    sectionPos[0] + def.dir[0] * OFFSET,
    sectionPos[1],
    sectionPos[2] + def.dir[2] * OFFSET,
  ];

  const getHit = useCallback((clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(GROUND, hit) ? hit : null;
  }, [camera, raycaster, gl]);

  const handlePointerDown = useCallback((e) => {
    e.stopPropagation();

    const initialHit = getHit(e.clientX, e.clientY);
    if (!initialHit) return;
    lastHit.current = initialHit.clone();

    if (controlsRef?.current) controlsRef.current.enabled = false;
    document.body.style.cursor = 'grabbing';

    const onMove = (ev) => {
      const newHit = getHit(ev.clientX, ev.clientY);
      if (!newHit || !lastHit.current) return;

      const delta = newHit.clone().sub(lastHit.current);
      lastHit.current = newHit.clone();

      const { sections, updateSection } = useStore.getState();
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return;

      const p = [...sec.position];
      if (def.axis === 'x') p[0] += delta.x;
      else p[2] += delta.z;
      updateSection(sectionId, { position: p });
    };

    const onUp = () => {
      lastHit.current = null;
      if (controlsRef?.current) controlsRef.current.enabled = true;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [def.axis, sectionId, getHit, controlsRef]);

  const color = hovered ? def.hover : def.color;

  return (
    <group
      position={pos}
      rotation={def.rotation}
      renderOrder={1000}
      onPointerDown={handlePointerDown}
      onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'grab'; }}
      onPointerLeave={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = ''; }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Shaft — cylinder default axis is +Y, so the group rotation maps +Y to the arrow direction */}
      <mesh position={[0, 0.35, 0]} renderOrder={1000}>
        <cylinderGeometry args={[0.07, 0.07, 0.7, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          depthTest={false}
          depthWrite={false}
          transparent
        />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.875, 0]} renderOrder={1000}>
        <coneGeometry args={[0.17, 0.35, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          depthTest={false}
          depthWrite={false}
          transparent
        />
      </mesh>
    </group>
  );
}

export function SelectionHandles({ controlsRef }) {
  const selectedId = useStore((s) => s.selectedId);
  const sections = useStore((s) => s.sections);
  const section = sections.find((s) => s.id === selectedId);

  if (!section) return null;

  return (
    <>
      {ARROW_DEFS.map((def) => (
        <Arrow
          key={def.key}
          def={def}
          sectionId={section.id}
          sectionPos={section.position}
          controlsRef={controlsRef}
        />
      ))}
    </>
  );
}
