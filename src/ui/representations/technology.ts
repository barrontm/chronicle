import { F, type Representation } from './types';

/** A cog of `n` teeth, as one path with its hole. */
function cog(cx: number, cy: number, ro: number, ri: number, n: number, hole: number): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    d += `${i ? 'L' : 'M'}${p(a0 + 0.06)}L${p(a1 - 0.06)}`;
  }
  return `${d}ZM${cx} ${cy - hole}a${hole} ${hole} 0 1 0 0 ${hole * 2}a${hole} ${hole} 0 1 0 0 ${-hole * 2}z`;
}

/** A cog: a point (a tech tree and diffusion on the map come later). */
export const technology: Representation = {
  kind: 'technology',
  glyph: `<path d="${cog(9, 9, 7.6, 5.4, 7, 2.4)}" ${F} fill-rule="evenodd"/>`,
  point: 'glyph',
  bar: 'bar',
  badge: true,
};
