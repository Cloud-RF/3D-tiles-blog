import { useEffect } from 'react';
import { useStore } from './store';
import { TUNNEL_LENGTH } from './tunnelSections';

const STEP = 0.5;
const BIG_STEP = TUNNEL_LENGTH; // shift+arrow snaps by full section length

export function useKeyboardMove() {
  const selectedId = useStore((s) => s.selectedId);

  useEffect(() => {
    if (selectedId === null) return;

    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();

      const step = e.shiftKey ? BIG_STEP : STEP;
      const { sections, updateSection } = useStore.getState();
      const section = sections.find((s) => s.id === selectedId);
      if (!section) return;

      const pos = [...section.position];
      if (e.key === 'ArrowLeft')  pos[0] -= step;
      if (e.key === 'ArrowRight') pos[0] += step;
      if (e.key === 'ArrowDown')  pos[2] += step;
      if (e.key === 'ArrowUp')    pos[2] -= step;

      updateSection(selectedId, { position: pos });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);
}
