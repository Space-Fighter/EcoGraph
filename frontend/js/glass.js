// Liquid glass refraction. Every .glass element gets its own SVG filter used as backdrop-filter:
// a displacement map, drawn for that element's size, bends the wallpaper near the rim and leaves
// the middle untouched. Bending each colour channel by a slightly different amount makes the
// chromatic fringe. Only Chromium applies url() in backdrop-filter, so others keep the CSS blur.
const Glass = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BEZEL = 26;        // width of the bending rim, in CSS pixels
  const STRENGTH = 58;     // how far the rim shifts the backdrop, in CSS pixels
  const FRINGE = 0.12;     // red and blue differ from green by this share of the strength
  let nextId = 0;

  // Engine check, not CSS.supports: that can report url() backdrop filters as supported in
  // browsers that do not draw them.
  function supportsRefraction() {
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (brands && brands.some((b) => b.brand === 'Chromium')) return true;
    return /\bChrome\/\d+/.test(navigator.userAgent) && !/\bFirefox\//.test(navigator.userAgent);
  }

  // Distance from a point to the inside edge of a rounded rectangle, with the outward normal.
  function edgeOf(px, py, w, h, r) {
    const qx = Math.abs(px - w / 2) - (w / 2 - r);
    const qy = Math.abs(py - h / 2) - (h / 2 - r);
    const sx = Math.sign(px - w / 2) || 1, sy = Math.sign(py - h / 2) || 1;
    if (qx > 0 && qy > 0) {
      const len = Math.hypot(qx, qy) || 1;
      return { d: r - len, nx: (sx * qx) / len, ny: (sy * qy) / len };
    }
    if (qx > qy) return { d: r - qx, nx: sx, ny: 0 };
    return { d: r - qy, nx: 0, ny: sy };
  }

  // Red holds the x shift and green the y shift; 128 means no shift.
  function displacementMap(w, h, radius) {
    const scale = 0.5;
    const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const r = Math.min(radius, w / 2, h / 2);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const { d, nx, ny } = edgeOf((i + 0.5) / scale, (j + 0.5) / scale, w, h, r);
        const t = Math.max(0, Math.min(1, 1 - d / BEZEL));
        const bend = t * t * t;          // like a convex lens: sharply stronger right at the rim
        const k = (i + j * cw) * 4;
        img.data[k] = 128 - nx * bend * 127;
        img.data[k + 1] = 128 - ny * bend * 127;
        img.data[k + 2] = 128;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
    parent.appendChild(node);
    return node;
  }

  function channel(filter, scale, keep, result) {
    const shifted = result + '-shift';
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result: shifted }, filter);
    const m = keep === 'r' ? '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'
            : keep === 'g' ? '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'
            : '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0';
    el('feColorMatrix', { in: shifted, type: 'matrix', values: m, result }, filter);
  }

  function buildFilter(host, id, w, h, radius) {
    const old = host.querySelector('#' + id);
    if (old) old.remove();
    const f = el('filter', { id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse',
                             primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, host);
    el('feImage', { href: displacementMap(w, h, radius), x: 0, y: 0, width: w, height: h,
                    preserveAspectRatio: 'none', result: 'map' }, f);
    channel(f, STRENGTH * (1 + FRINGE), 'r', 'red');
    channel(f, STRENGTH, 'g', 'green');
    channel(f, STRENGTH * (1 - FRINGE), 'b', 'blue');
    el('feBlend', { in: 'red', in2: 'green', mode: 'screen', result: 'rg' }, f);
    el('feBlend', { in: 'rg', in2: 'blue', mode: 'screen' }, f);
  }

  function attach(node, host) {
    const id = 'lg-' + (nextId++);
    let lastW = 0, lastH = 0, timer = null;
    const refresh = () => {
      const w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight);
      if (!w || !h || (w === lastW && h === lastH)) return;
      lastW = w; lastH = h;
      buildFilter(host, id, w, h, parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0);
      // The photo is full of fine detail, so it needs a real blur for text on the glass to read.
      const css = 'url(#' + id + ') blur(11px) saturate(1.45)';
      node.style.backdropFilter = 'none';   // forces Chromium to pick up the rebuilt filter
      void node.offsetWidth;
      node.style.backdropFilter = css;
    };
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 80);
    }).observe(node);
    refresh();
  }

  function init() {
    if (!supportsRefraction()) return;
    const host = document.getElementById('glass-filters');
    document.querySelectorAll('.glass').forEach((node) => attach(node, host));
    document.documentElement.classList.add('refraction');
  }

  return { init };
})();
