import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useStore } from '../store';
import { TunnelSection } from './TunnelSection';
import { DragPreview } from './DragPreview';
import { SelectionHandles } from './SelectionHandles';

export function Scene({ dragging }) {
  const sections = useStore((s) => s.sections);
  const setSelected = useStore((s) => s.setSelected);
  const controlsRef = useRef();

  const hiddenId = dragging?.kind === 'move' ? dragging.id : null;

  return (
    <Canvas
      camera={{ position: [11, 9, 14], fov: 42 }}
      shadows
      style={{ background: '#1a1a2e', display: 'block', width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 16, 10]} intensity={1.2} castShadow />
      <pointLight position={[-8, 6, -8]} intensity={0.4} color="#6699ff" />

      <Grid
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.3}
        cellColor="#223"
        sectionSize={4}
        sectionThickness={0.8}
        sectionColor="#336"
        position={[0, -1, 0]}
        infiniteGrid
        fadeDistance={50}
      />

      {/* Invisible ground for deselect clicks */}
      <mesh
        position={[0, -1.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => setSelected(null)}
        visible={false}
      >
        <planeGeometry args={[300, 300]} />
        <meshBasicMaterial />
      </mesh>

      {sections.map((s) => (
        <TunnelSection key={s.id} section={s} hidden={hiddenId === s.id} />
      ))}

      <DragPreview dragging={dragging} />
      <SelectionHandles controlsRef={controlsRef} />

      <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate makeDefault />
    </Canvas>
  );
}
