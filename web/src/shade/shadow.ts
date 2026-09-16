// Shadow mask from a heightmap — port of pipeline/10_sun_shade.shadow_mask.
// Sheared scanline sweep, O(N): walk rows in the direction shadows travel
// (away from the sun), keep a running "shadow horizon" H per column that
// drops by tan(el)·step each row and shifts sideways by the sun's
// azimuth; a cell is shaded when the horizon is above it.
//
// z: row-major heights (metres), north-up (row 0 = north). res: metres per
// cell. Returns Uint8Array 1 = shaded.
export function shadowMask(z: Float32Array, w: number, h: number, res: number, azDeg: number, elDeg: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (elDeg <= 0) {
    out.fill(1);
    return out;
  }
  const az = (azDeg * Math.PI) / 180;
  // unit vector shadows travel along: east, north
  const de = -Math.sin(az);
  const dn = -Math.cos(az);
  let drow = -dn; // row axis points south
  let dcol = de;
  // orient so that |drow| >= |dcol|, drow > 0, dcol >= 0 — work in a
  // transformed index space instead of copying arrays
  const tpose = Math.abs(dcol) > Math.abs(drow);
  if (tpose) [drow, dcol] = [dcol, drow];
  const fRow = drow < 0;
  if (fRow) drow = -drow;
  const fCol = dcol < 0;
  if (fCol) dcol = -dcol;
  const nRows = tpose ? w : h;
  const nCols = tpose ? h : w;
  // index of (r, c) in the oriented space -> original array
  const idx = (r: number, c: number) => {
    let rr = fRow ? nRows - 1 - r : r;
    let cc = fCol ? nCols - 1 - c : c;
    if (tpose) [rr, cc] = [cc, rr];
    return rr * w + cc;
  };
  const slope = dcol / drow; // in [0, 1]
  const step = res * Math.hypot(1, slope);
  const drop = Math.tan((elDeg * Math.PI) / 180) * step;
  const H = new Float32Array(nCols);
  for (let c = 0; c < nCols; c++) H[c] = z[idx(0, c)];
  let shifted = 0;
  const EPS = 0.05;
  for (let r = 1; r < nRows; r++) {
    const want = Math.round(slope * r);
    if (want !== shifted) {
      for (let c = nCols - 1; c > 0; c--) H[c] = H[c - 1];
      H[0] = -1e9;
      shifted = want;
    }
    for (let c = 0; c < nCols; c++) {
      const hv = H[c] - drop;
      const zi = idx(r, c);
      const zv = z[zi];
      if (hv > zv + EPS) out[zi] = 1;
      H[c] = hv > zv ? hv : zv;
    }
  }
  return out;
}
