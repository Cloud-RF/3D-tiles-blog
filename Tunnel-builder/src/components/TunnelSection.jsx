import { useStore } from '../store';
import { getSectionPieces, getBBox } from '../sectionGeometry';

export function TunnelSection({ section, hidden = false }) {
  const selectedId = useStore((s) => s.selectedId);
  const setSelected = useStore((s) => s.setSelected);
  const removeSection = useStore((s) => s.removeSection);
  const isSelected = selectedId === section.id;

  if (hidden) return null;

  const color = isSelected ? '#5a9fff' : '#3a6f95';
  const pieces = getSectionPieces(section.type);
  const [bw, bh, bd] = getBBox(section.type);

  return (
    <group
      position={section.position}
      rotation={section.rotation}
      onClick={(e) => { e.stopPropagation(); setSelected(isSelected ? null : section.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); removeSection(section.id); }}
    >
      {pieces.map((p, i) => (
        <mesh key={i} position={p.position} rotation={p.rotation} castShadow receiveShadow>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      ))}
      {isSelected && (
        <mesh>
          <boxGeometry args={[bw + 0.08, bh + 0.08, bd + 0.08]} />
          <meshStandardMaterial color="#ffff44" transparent opacity={0.08} wireframe />
        </mesh>
      )}
    </group>
  );
}
