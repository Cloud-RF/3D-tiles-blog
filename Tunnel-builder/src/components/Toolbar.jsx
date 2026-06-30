import { useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { SECTION_TYPES } from '../tunnelSections';
import { exportToGLB, downloadBuffer } from '../exportGLB';
import {
  listSaves,
  saveTunnel,
  loadTunnel,
  deleteSave,
  downloadTunnelFile,
  readTunnelFile,
} from '../saves';

export function Toolbar({ onStartDrag, onStartRedrag }) {
  const selectedId = useStore((s) => s.selectedId);
  const removeSection = useStore((s) => s.removeSection);
  const snapSectionToNearest = useStore((s) => s.snapSectionToNearest);
  const loadSections = useStore((s) => s.loadSections);
  const sections = useStore((s) => s.sections);
  const [exportStatus, setExportStatus] = useState(null); // null | string
  const [saveName, setSaveName] = useState('');
  const [saves, setSaves] = useState(() => listSaves());
  const [saveMsg, setSaveMsg] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refreshSaves = useCallback(() => setSaves(listSaves()), []);

  const flashMsg = useCallback((text) => {
    setSaveMsg(text);
    setTimeout(() => setSaveMsg((m) => (m === text ? null : m)), 2500);
  }, []);

  const handleSave = useCallback(() => {
    try {
      saveTunnel(saveName, sections);
      flashMsg(`Saved "${saveName.trim()}"`);
      setSaveName('');
      refreshSaves();
    } catch (err) {
      flashMsg(err.message);
    }
  }, [saveName, sections, flashMsg, refreshSaves]);

  const handleLoad = useCallback((name) => {
    try {
      const loaded = loadTunnel(name);
      loadSections(loaded);
      flashMsg(`Loaded "${name}"`);
    } catch (err) {
      flashMsg(err.message);
    }
  }, [loadSections, flashMsg]);

  const handleDelete = useCallback((name) => {
    if (!confirm(`Delete save "${name}"?`)) return;
    deleteSave(name);
    refreshSaves();
    flashMsg(`Deleted "${name}"`);
  }, [refreshSaves, flashMsg]);

  const handleExportFile = useCallback(() => {
    const fname = (saveName.trim() || 'tunnel') + '.json';
    downloadTunnelFile(sections, fname);
  }, [saveName, sections]);

  // Re-import the same file by resetting the input's value first.
  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing same file
    if (!file) return;
    try {
      const loaded = await readTunnelFile(file);
      loadSections(loaded);
      flashMsg(`Imported ${file.name}`);
    } catch (err) {
      flashMsg(err.message);
    }
  }, [loadSections, flashMsg]);

  const handleClearAll = useCallback(() => {
    if (!sections.length) return;
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    // Simplest, most reliable reset: a full page reload.
    // (Saved tunnels in localStorage are not affected.)
    window.location.reload();
  }, [sections.length, confirmClear]);

  // Re-read saves if another tab modified them
  useEffect(() => {
    const onStorage = () => refreshSaves();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshSaves]);

  const handleExport = useCallback(async () => {
    if (exportStatus) return; // already running
    try {
      setExportStatus('Starting…');
      const glb = await exportToGLB(sections, setExportStatus);
      downloadBuffer(glb, 'tunnel.glb');
      setExportStatus(null);
    } catch (err) {
      console.error(err);
      setExportStatus(`Error: ${err.message}`);
      setTimeout(() => setExportStatus(null), 4000);
    }
  }, [sections, exportStatus]);

  return (
    <div style={s.bar}>
      <div style={s.title}>Tunnel Builder</div>

      <div style={s.group}>
        <div style={s.label}>Drag to place</div>
        <PieceCard
          type={SECTION_TYPES.STRAIGHT}
          label="Straight"
          desc="1.5 × 2 × 4 m"
          onMouseDown={(e) => { e.preventDefault(); onStartDrag(SECTION_TYPES.STRAIGHT); }}
        />
        <PieceCard
          type={SECTION_TYPES.CORNER}
          label="Corner (90°)"
          desc="L turn"
          onMouseDown={(e) => { e.preventDefault(); onStartDrag(SECTION_TYPES.CORNER); }}
        />
        <PieceCard
          type={SECTION_TYPES.CORNER_ROUND}
          label="Corner (round)"
          desc="smooth 90° turn"
          onMouseDown={(e) => { e.preventDefault(); onStartDrag(SECTION_TYPES.CORNER_ROUND); }}
        />
        <PieceCard
          type={SECTION_TYPES.S_PIECE}
          label="S-Curve"
          desc="lane shift"
          onMouseDown={(e) => { e.preventDefault(); onStartDrag(SECTION_TYPES.S_PIECE); }}
        />
        <PieceCard
          type={SECTION_TYPES.JUNCTION}
          label="4-Way Junction"
          desc="cross 4 m × 4 m"
          onMouseDown={(e) => { e.preventDefault(); onStartDrag(SECTION_TYPES.JUNCTION); }}
        />
      </div>

      {selectedId !== null && (
        <div style={s.group}>
          <div style={s.label}>Selected</div>
          <button
            style={{ ...s.btn, ...s.btnMove }}
            onClick={() => onStartRedrag?.(selectedId)}
            title="Detach this piece and re-drag it to a new spot — it will snap to nearby connectors"
          >
            ✥ Move &amp; re-snap
          </button>
          <button
            style={{
              ...s.btn,
              ...(sections.length < 2 ? s.btnDisabled : s.btnSnap),
            }}
            onClick={() => snapSectionToNearest(selectedId)}
            disabled={sections.length < 2}
            title="Move & rotate the selected piece so its nearest connector mates with the nearest connector on another piece"
          >
            ⇆ Snap to nearest
          </button>
          <button style={{ ...s.btn, ...s.danger }} onClick={() => removeSection(selectedId)}>
            Delete section
          </button>
        </div>
      )}

      <div style={s.hints}>
        <div style={s.hint}>• Drag piece onto canvas</div>
        <div style={s.hint}>• Green = snap connector</div>
        <div style={s.hint}>• Click to select</div>
        <div style={s.hint}>• Double-click to delete</div>
        <div style={s.hint}>• Drag red/blue arrows to move</div>
        <div style={s.hint}>• Arrow keys to move (0.5m)</div>
        <div style={s.hint}>• Shift+Arrow = 4m step</div>
        <div style={s.hint}>• Right-drag / scroll to orbit</div>
      </div>
      <div style={s.legend}>
        <span style={{ color: '#ff4455' }}>■</span> X axis &nbsp;
        <span style={{ color: '#4488ff' }}>■</span> Z axis
      </div>

      <div style={s.group}>
        <div style={s.label}>Save / Load</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="Name…"
            style={s.input}
          />
          <button
            style={{
              ...s.btn,
              ...(sections.length === 0 || !saveName.trim() ? s.btnDisabled : s.btnSave),
              width: 'auto',
              padding: '5px 10px',
            }}
            onClick={handleSave}
            disabled={sections.length === 0 || !saveName.trim()}
            title="Save the current tunnel under this name"
          >
            Save
          </button>
        </div>

        {saves.length > 0 && (
          <div style={s.saveList}>
            {saves.map(({ name }) => (
              <div key={name} style={s.saveRow}>
                <button
                  style={s.saveName}
                  onClick={() => handleLoad(name)}
                  title={`Load "${name}"`}
                >
                  {name}
                </button>
                <button
                  style={s.saveDel}
                  onClick={() => handleDelete(name)}
                  title={`Delete "${name}"`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            style={{
              ...s.btn,
              ...(sections.length === 0 ? s.btnDisabled : {}),
              fontSize: 11,
            }}
            onClick={handleExportFile}
            disabled={sections.length === 0}
            title="Download the current tunnel as a .json file"
          >
            ↓ Download
          </button>
          <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
            <button
              type="button"
              style={{ ...s.btn, fontSize: 11, pointerEvents: 'none', flex: 1 }}
              tabIndex={-1}
            >
              ↑ Upload
            </button>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              title="Upload a tunnel from a .json file"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
              }}
            />
          </div>
        </div>

        <button
          style={{
            ...s.btn,
            ...(sections.length === 0 ? s.btnDisabled : s.danger),
            fontSize: 11,
          }}
          onClick={handleClearAll}
          disabled={sections.length === 0}
          title="Remove every piece from the scene (will refresh the page)"
        >
          {confirmClear ? 'Click again to confirm' : 'Clear scene'}
        </button>

        {saveMsg && <div style={s.saveMsg}>{saveMsg}</div>}
      </div>

      <div style={s.group}>
        <div style={s.label}>Export</div>
        <button
          style={{
            ...s.btn,
            ...(sections.length === 0 || exportStatus ? s.btnDisabled : s.btnExport),
          }}
          onClick={handleExport}
          disabled={sections.length === 0 || !!exportStatus}
          title="Export as GLB with Draco compression"
        >
          {exportStatus ? exportStatus : '⬇ Download GLB'}
        </button>
        {exportStatus && <div style={s.statusBar} />}
      </div>

      <div style={s.footer}>{sections.length} section{sections.length !== 1 ? 's' : ''} placed</div>
    </div>
  );
}

function PieceCard({ type, label, desc, onMouseDown }) {
  return (
    <div style={s.card} onMouseDown={onMouseDown} title={`Drag to place ${label}`}>
      <PieceIcon type={type} />
      <div>
        <div style={s.cardLabel}>{label}</div>
        <div style={s.cardDesc}>{desc}</div>
      </div>
    </div>
  );
}

function PieceIcon({ type }) {
  if (type === SECTION_TYPES.STRAIGHT) {
    return (
      <svg width="48" height="32" viewBox="0 0 48 32" style={{ flexShrink: 0 }}>
        <rect x="2" y="8" width="44" height="16" fill="none" stroke="#4a9eff" strokeWidth="1.5" rx="1" />
        <line x1="2" y1="16" x2="46" y2="16" stroke="#4a9eff" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5" />
      </svg>
    );
  }
  if (type === SECTION_TYPES.JUNCTION) {
    return (
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <rect x="2" y="16" width="44" height="16" fill="none" stroke="#4a9eff" strokeWidth="1.5" rx="1" />
        <rect x="16" y="2" width="16" height="44" fill="none" stroke="#4a9eff" strokeWidth="1.5" rx="1" />
      </svg>
    );
  }
  if (type === SECTION_TYPES.CORNER) {
    return (
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <path
          d="M2 2 L2 46 L46 46 L46 30 L18 30 L18 2 Z"
          fill="none"
          stroke="#4a9eff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (type === SECTION_TYPES.CORNER_ROUND) {
    return (
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <path
          d="M2 2 L2 46 L46 46 L46 30 A28 28 0 0 0 18 2 Z"
          fill="none"
          stroke="#4a9eff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (type === SECTION_TYPES.S_PIECE) {
    return (
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <path
          d="M14 2 C14 18 34 18 34 24 C34 30 14 30 14 46"
          fill="none"
          stroke="#4a9eff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M22 2 C22 18 42 18 42 24 C42 30 22 30 22 46"
          fill="none"
          stroke="#4a9eff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    );
  }
  return null;
}

const s = {
  bar: {
    width: 200,
    minWidth: 200,
    background: '#0d1117',
    borderRight: '1px solid #21262d',
    padding: '14px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    color: '#c9d1d9',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    userSelect: 'none',
    overflowY: 'auto',
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: '#58a6ff',
    borderBottom: '1px solid #21262d',
    paddingBottom: 10,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#6e7681',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 8px',
    border: '1px solid #30363d',
    borderRadius: 6,
    background: '#161b22',
    cursor: 'grab',
    transition: 'border-color 0.15s',
  },
  cardLabel: {
    fontWeight: 600,
    fontSize: 12,
    color: '#e6edf3',
  },
  cardDesc: {
    fontSize: 10,
    color: '#8b949e',
    marginTop: 1,
  },
  btn: {
    padding: '5px 10px',
    border: '1px solid #30363d',
    borderRadius: 4,
    background: '#161b22',
    color: '#c9d1d9',
    
  btnMove: {
    borderColor: '#d29922',
    color: '#d29922',
    fontWeight: 600,
  },
  btnSave: {
    borderColor: '#a371f7',
    color: '#a371f7',
    fontWeight: 600,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '5px 8px',
    border: '1px solid #30363d',
    borderRadius: 4,
    background: '#0d1117',
    color: '#c9d1d9',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
  },
  saveList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    maxHeight: 140,
    overflowY: 'auto',
    border: '1px solid #21262d',
    borderRadius: 4,
    padding: 3,
    background: '#0d1117',
  },
  saveRow: {
    display: 'flex',
    gap: 3,
  },
  saveName: {
    flex: 1,
    minWidth: 0,
    padding: '4px 6px',
    border: '1px solid transparent',
    borderRadius: 3,
    background: 'transparent',
    color: '#c9d1d9',
    cursor: 'pointer',
    fontSize: 11,
    textAlign: 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  saveDel: {
    width: 22,
    padding: 0,
    border: '1px solid transparent',
    borderRadius: 3,
    background: 'transparent',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: 12,
  },
  saveMsg: {
    fontSize: 10,
    color: '#7ee787',
    paddingTop: 2,
  },cursor: 'pointer',
    fontSize: 12,
    
  btnSnap: {
    borderColor: '#58a6ff',
    color: '#58a6ff',
    fontWeight: 600,
  },width: '100%',
    textAlign: 'center',
  },
  danger: {
    borderColor: '#f85149',
    color: '#f85149',
  },
  btnExport: {
    borderColor: '#3fb950',
    color: '#3fb950',
    fontWeight: 600,
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
  statusBar: {
    height: 2,
    background: 'linear-gradient(90deg, #3fb950, #58a6ff)',
    borderRadius: 1,
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  hints: {
    borderTop: '1px solid #21262d',
    paddingTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  hint: {
    fontSize: 11,
    color: '#6e7681',
    lineHeight: 1.6,
  },
  legend: {
    fontSize: 11,
    color: '#8b949e',
    paddingTop: 4,
  },
  footer: {
    fontSize: 11,
    color: '#6e7681',
    marginTop: 'auto',
    borderTop: '1px solid #21262d',
    paddingTop: 8,
  },
};
