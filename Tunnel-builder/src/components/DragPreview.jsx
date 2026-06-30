import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { useStore } from '../store';
import { getBBox } from '../sectionGeometry';

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function DragPreview({ dragging }) {
  const meshRef = useRef();
  const { camera, raycaster, gl } = useThree();
  const findSnap = useStore((s) => s.findSnap);
  const addSection = useStore((s) => s.addSection);
  const updateSection = useStore((s) => s.updateSection);

  const snapRef = useRef(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = gl.domElement;
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [gl]);

  useFrame(() => {
    if (!meshRef.current || !dragging) return;
    raycaster.setFromCamera(pointerRef.current, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, hit);

    const excludeId = dragging.kind === 'move' ? dragging.id : null;
    const snap = findSnap(dragging.type, hit, excludeId);
    snapRef.current = snap;

    if (snap) {
      meshRef.current.position.set(...snap.position);
      meshRef.current.rotation.set(...snap.rotation);
      meshRef.current.material.color.set('#00ff88');
      meshRef.current.material.opacity = 0.6;
    } else {
      meshRef.current.position.set(hit.x, 0, hit.z);
      meshRef.current.rotation.set(0, 0, 0);
      meshRef.current.material.color.set('#88ccff');
      meshRef.current.material.opacity = 0.4;
    }
  });

  useEffect(() => {
    if (!dragging) return;

    const commit = () => {
      const pos = meshRef.current?.position;
      const rot = meshRef.current?.rotation;
      if (dragging.kind === 'move') {
        if (snapRef.current) {
          updateSection(dragging.id, {
            position: snapRef.current.position,
            rotation: snapRef.current.rotation,
          });
        } else if (pos) {
          updateSection(dragging.id, {
            position: [pos.x, pos.y, pos.z],
            rotation: [rot.x, rot.y, rot.z],
          });
        }
      } else {
        if (snapRef.current) {
          addSection(dragging.type, snapRef.current.position, snapRef.current.rotation);
        } else if (pos) {
          addSection(dragging.type, [pos.x, pos.y, pos.z], [rot.x, rot.y, rot.z]);
        }
      }
      dragging.onDone();
    };

    if (dragging.kind === 'move') {
      // Click-to-drop mode (entered from a button click, so mouse is already up).
      const onDown = (e) => {
        // Ignore clicks on UI outside the canvas
        if (e.target !== gl.domElement) return;
        e.preventDefault();
        e.stopPropagation();
        commit();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') dragging.onDone();
      };
      window.addEventListener('mousedown', onDown, { capture: true });
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('mousedown', onDown, { capture: true });
        window.removeEventListener('keydown', onKey);
      };
    } else {
      // Mouse-up mode (entered from mousedown on a PieceCard).
      const onUp = () => commit();
      window.addEventListener('mouseup', onUp, { once: true });
      return () => window.removeEventListener('mouseup', onUp);
    }
  }, [dragging, addSection, updateSection, gl]);

  if (!dragging) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={getBBox(dragging.type)} />
      <meshStandardMaterial transparent opacity={0.4} color="#88ccff" />
    </mesh>
  );
}
