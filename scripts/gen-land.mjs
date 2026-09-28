// Regenerates assets/land-dots.json: a Fibonacci-sphere sampling of the world's
// land masses (Natural Earth 110m via world-atlas), stored as [lat*10, lon*10, ...].
import fs from 'node:fs';
const topo = JSON.parse(fs.readFileSync(new URL('../node_modules/world-atlas/land-110m.json', import.meta.url)));
import { feature } from 'topojson-client';
const land = feature(topo, topo.objects.land);
const polys = [];
function unwrap(ring) { // make rings that cross the antimeridian continuous
  const out = []; let off = 0;
  for (let i = 0; i < ring.length; i++) {
    if (i) { const d = ring[i][0] - ring[i - 1][0]; if (d > 180) off -= 360; else if (d < -180) off += 360; }
    out.push([ring[i][0] + off, ring[i][1]]);
  }
  return out;
}
for (const f of land.features) {
  const g = f.geometry;
  const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of ps) polys.push(p.map(unwrap));
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (lon, lat, p) => inRing(lon, lat, p[0]) && !p.slice(1).some(h => inRing(lon, lat, h));
const inLand = (lon, lat) => polys.some(p => inPoly(lon, lat, p) || inPoly(lon + 360, lat, p) || inPoly(lon - 360, lat, p));
const N = 14000, out = [], ga = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
  const lat = Math.asin(y) * 180 / Math.PI, lon = ((Math.atan2(Math.sin(th) * r, Math.cos(th) * r) * 180) / Math.PI);
  if (lat < -60) continue; // drop Antarctica for a cleaner globe
  if (inLand(lon, lat)) out.push(Math.round(lat * 10), Math.round(lon * 10));
}
fs.writeFileSync(new URL('../assets/land-dots.json', import.meta.url), JSON.stringify(out));
console.log('dots', out.length / 2, 'bytes', JSON.stringify(out).length);
