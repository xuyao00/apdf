// PDF links usually identify a destination, not the bounds of a figure. Work
// from caption geometry and rendered ink, and decline uncertain crops.
export function referenceKind(label) {
  const found = /\b(fig(?:ure)?|tab(?:le)?)(?=[\s._:\-\d]|$)\.?[\s._:-]*([A-Z]?\d+(?:[.-]\d+)*[a-z]?|[IVXLCDM]+(?=[\s.:),;]|$))?/i.exec(label);
  return found ? { kind: /^fig/i.test(found[1]) ? 'figure' : 'table', number: found[2]?.replace(/\.$/, '').toLowerCase() } : null;
}
export function referenceLabel(destination, visible) {
  const kind = referenceKind(destination);
  if (kind?.number) return `${kind.kind} ${kind.number}`;
  if (referenceKind(visible)) return visible.trim();
  if (kind && /^(?:[A-Z]?\d+(?:[.-]\d+)*[a-z]?|[IVXLCDM]+)$/i.test(visible.trim())) return `${kind.kind} ${visible.trim()}`;
  return destination ? destination.replace(/[._:]/g, ' ') : visible || 'Reference';
}
export function captionLines(boxes) {
  const rows = [];
  for (const box of [...boxes].filter(b => b.text.trim()).sort((a, b) => a.top - b.top || a.left - b.left)) {
    let row = rows.find(r => Math.abs(r.top - box.top) < Math.min(r.height, box.height) * .45);
    if (!row) { row = { top: box.top, height: box.height, boxes: [] }; rows.push(row); }
    row.boxes.push(box);
  }
  const lines = [];
  for (const row of rows) {
    let line;
    for (const box of row.boxes.sort((a, b) => a.left - b.left)) {
      if (!line || box.left - line.right > Math.max(24, box.height * 3)) {
        line = { text: '', left: box.left, right: box.left, top: box.top, bottom: box.top + box.height, height: box.height };
        lines.push(line);
      }
      line.text += (line.text && box.left - line.right > 1 ? ' ' : '') + box.text;
      line.right = Math.max(line.right, box.left + box.width); line.bottom = Math.max(line.bottom, box.top + box.height);
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}
export function detectReferenceRegion({ width, height, ink, boxes }, label, anchor) {
  const descriptor = referenceKind(label);
  if (!descriptor) return null;
  const lines = captionLines(boxes);
  const captions = lines.filter(line => /^(?:fig(?:ure)?|tab(?:le)?)\.?\s*(?:[A-Z]?\d|[IVXLCDM]+(?=[\s.:),;]|$))/i.test(line.text));
  let candidates = captions.filter(line => {
    const kind = referenceKind(line.text);
    return kind?.kind === descriptor.kind && (!descriptor.number || kind.number === descriptor.number);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const distance = line => Math.abs(line.top - (anchor?.y ?? 0)) + Math.abs(line.left - (anchor?.x ?? line.left)) * .25;
    return distance(a) - distance(b);
  });
  const caption = { ...candidates[0] };
  // Keep wrapped caption lines, but stop before the next object or paragraph.
  for (const line of lines.filter(l => l.top > caption.top)) {
    if (line.bottom <= caption.bottom || line.right < caption.left || line.left > caption.right + 20) continue;
    if (/\S\s{2,}\S/.test(line.text) || lines.some(other => other !== line && Math.abs(other.top - line.top) < line.height * .4 && other.left > line.right + 20)) break;
    if (line.top - caption.bottom > caption.height * .75 || captions.includes(line) || Math.abs(line.left - caption.left) > 24) break;
    caption.bottom = line.bottom; caption.right = Math.max(caption.right, line.right);
  }
  const mid = width / 2;
  let left = 12, right = width - 12;
  // A column-sized caption plus substantial text in the other column is a
  // stronger signal than the caption's width alone (short full-width captions).
  if (caption.right < mid - 12 && lines.filter(l => l.left > mid + 8 && l.right - l.left > width * .24).length >= 5) right = mid - 8;
  else if (caption.left > mid + 8 && lines.filter(l => l.right < mid - 12 && l.right - l.left > width * .24).length >= 5) left = mid + 8;
  left = Math.floor(left); right = Math.ceil(right);
  const textMask = new Uint8Array(width * height);
  for (const box of boxes) for (let y = Math.max(0, Math.floor(box.top)); y < Math.min(height, Math.ceil(box.top + box.height)); y++) {
    textMask.fill(1, y * width + Math.max(0, Math.floor(box.left)), y * width + Math.min(width, Math.ceil(box.left + box.width)));
  }
  function body(direction) {
    const start = direction < 0 ? Math.floor(caption.top - 3) : Math.ceil(caption.bottom + 3);
    const gapLimit = Math.max(18, caption.height * 1.8);
    let blank = 0, started = false, top = height, bottom = 0, x1 = right, x2 = left, pixels = 0, graphics = 0;
    for (let y = start; y >= 12 && y < height - 12; y += direction) {
      let count = 0;
      for (let x = left; x < right; x++) if (ink[y * width + x]) count++;
      if (count < 2) {
        blank++;
        if (blank > (started ? gapLimit : Math.max(48, caption.height * 4))) break;
        continue;
      }
      started = true; blank = 0; top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      for (let x = left; x < right; x++) if (ink[y * width + x]) {
        x1 = Math.min(x1, x); x2 = Math.max(x2, x + 1); pixels++;
        if (!textMask[y * width + x]) graphics++;
      }
    }
    if (!started || bottom - top < 16 || x2 - x1 < 35) return null;
    const content = lines.filter(l => l.top >= top - 3 && l.bottom <= bottom + 4 && l.left < right && l.right > left);
    const rows = [];
    for (const line of content) {
      let row = rows.find(r => Math.abs(r.top - line.top) < caption.height * .6);
      if (!row) { row = { top: line.top, cells: 0, spaced: false }; rows.push(row); }
      row.cells++; row.spaced ||= /\S\s{2,}\S/.test(line.text);
    }
    const graphicRatio = graphics / Math.max(1, pixels);
    const tabular = rows.filter(row => row.cells > 1 || row.spaced).length >= 2;
    if (descriptor.kind === 'figure' && (graphicRatio < .15 || bottom - top < 30)) return null;
    if (descriptor.kind === 'table' && !(tabular || (rows.length >= 2 && graphicRatio > .12))) return null;
    const preferred = descriptor.kind === 'figure' ? direction < 0 : direction > 0;
    return { left: Math.min(x1, caption.left), right: Math.max(x2, caption.right), top: Math.min(top, caption.top), bottom: Math.max(bottom, caption.bottom), score: graphicRatio * 3 + (tabular ? 2 : 0) + (preferred ? .5 : 0) };
  }
  const region = [body(-1), body(1)].filter(Boolean).sort((a, b) => b.score - a.score)[0];
  if (!region) return null;
  const padding = 7;
  const crop = { left: Math.max(0, region.left - padding), top: Math.max(0, region.top - padding), right: Math.min(width, region.right + padding), bottom: Math.min(height, region.bottom + padding) };
  // Large ambiguous regions are safer as an explicitly labelled page preview.
  if ((crop.right - crop.left) * (crop.bottom - crop.top) > width * height * .8) return null;
  return { left: crop.left, top: crop.top, width: crop.right - crop.left, height: crop.bottom - crop.top };
}
