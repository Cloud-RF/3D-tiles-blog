// Save/load helpers for tunnel layouts.
// Saves live under localStorage with the SAVE_PREFIX. The index of save names
// is kept under INDEX_KEY so the UI can list them without scanning all keys.

const SAVE_PREFIX = 'tunnel-builder:save:';
const INDEX_KEY = 'tunnel-builder:saves';
const SCHEMA_VERSION = 1;

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(names) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(names));
}

export function listSaves() {
  return readIndex().map((name) => {
    let savedAt = null;
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + name);
      if (raw) savedAt = JSON.parse(raw).savedAt || null;
    } catch { /* ignore */ }
    return { name, savedAt };
  });
}

export function saveTunnel(name, sections) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Please enter a name.');
  const payload = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    sections,
  };
  localStorage.setItem(SAVE_PREFIX + trimmed, JSON.stringify(payload));
  const idx = readIndex();
  if (!idx.includes(trimmed)) writeIndex([...idx, trimmed]);
}

export function loadTunnel(name) {
  const raw = localStorage.getItem(SAVE_PREFIX + name);
  if (!raw) throw new Error(`No save named "${name}"`);
  const payload = JSON.parse(raw);
  if (!payload || !Array.isArray(payload.sections)) {
    throw new Error('Save file is corrupted.');
  }
  return payload.sections;
}

export function deleteSave(name) {
  localStorage.removeItem(SAVE_PREFIX + name);
  writeIndex(readIndex().filter((n) => n !== name));
}

// ── File import/export ──────────────────────────────────────────────────────

export function downloadTunnelFile(sections, filename = 'tunnel.json') {
  const payload = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    sections,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readTunnelFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.sections)) {
    throw new Error('Not a valid tunnel file.');
  }
  return payload.sections;
}
