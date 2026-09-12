/**
 * Getting files in and out.
 *
 * Nothing leaves the machine. There is no upload, no server and no analytics —
 * a drawing register names a client, a site and a programme long before any of
 * that is public, so the only safe place to check one is locally.
 */

const STORE_KEY = 'sheet-check:state:v1';

/** Read a dropped or chosen file as text. */
export function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsText(file);
  });
}

/** Read a file as bytes, for the PDF reader. */
export function readBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result)));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsArrayBuffer(file);
  });
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Wire an element as a drop target. Returns a teardown function. */
export function onDrop(element, handler) {
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
  const enter = (event) => { stop(event); element.dataset.dropping = 'true'; };
  const leave = (event) => { stop(event); delete element.dataset.dropping; };
  const drop = (event) => {
    stop(event);
    delete element.dataset.dropping;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) handler(files);
  };
  element.addEventListener('dragenter', enter);
  element.addEventListener('dragover', enter);
  element.addEventListener('dragleave', leave);
  element.addEventListener('drop', drop);
  return () => {
    element.removeEventListener('dragenter', enter);
    element.removeEventListener('dragover', enter);
    element.removeEventListener('dragleave', leave);
    element.removeEventListener('drop', drop);
  };
}

/** Hand the browser a file. */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Ask for a file the user picks. Resolves to null if they cancel. */
export function pickFiles(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.click();
  });
}

/**
 * Remember the settings — not the register.
 *
 * The convention, the required-sheet list and the project name are worth
 * keeping between sessions. The register itself is not stored anywhere: it is
 * the confidential part, and it would sit in the browser long after the check
 * was finished.
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  try {
    const text = localStorage.getItem(STORE_KEY);
    if (!text) return null;
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}
