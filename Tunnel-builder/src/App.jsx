import { useState, useCallback } from 'react';
import { Scene } from './components/Scene';
import { Toolbar } from './components/Toolbar';
import { useKeyboardMove } from './useKeyboardMove';
import { useStore } from './store';
import './App.css';

function App() {
  const [dragging, setDragging] = useState(null);
  useKeyboardMove();

  const handleStartDrag = useCallback((type) => {
    setDragging({ kind: 'new', type, onDone: () => setDragging(null) });
  }, []);

  const handleStartRedrag = useCallback((id) => {
    const sec = useStore.getState().sections.find((s) => s.id === id);
    if (!sec) return;
    setDragging({ kind: 'move', id, type: sec.type, onDone: () => setDragging(null) });
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Toolbar onStartDrag={handleStartDrag} onStartRedrag={handleStartRedrag} />
      <div style={{ flex: 1, position: 'relative' }}>
        <Scene dragging={dragging} />
        {dragging && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)', color: '#00ff88',
            padding: '6px 16px', borderRadius: 20, fontSize: 13, pointerEvents: 'none',
          }}>
            {dragging.kind === 'move'
              ? 'Moving piece — click to drop · Esc to cancel · green = snap point'
              : `Placing ${dragging.type} — release to drop · green = snap point`}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
