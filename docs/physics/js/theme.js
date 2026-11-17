// Gestione tema e palette colori.
// Ritorna solo oggetti colore, non tocca canvas né DOM.

export const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function col() {
  return isDark()
    ? { bg: '#0b0f14', tri: '#3a3a36', text: '#c2c0b6', grid: '#1e1e1c', accent: '#c8f542' }
    : { bg: '#eef2ff', tri: '#e5e3db', text: '#3d3d3a', grid: '#e5e4e0', accent: '#8aa81f' };
}
