// Loads the SVG art in assets/sprites/ into GPU textures. Each SVG is rasterised larger than its
// size on the map so it stays sharp when zoomed in, and any <g class="lights"> group is split into
// its own texture so windows can glow at night.
const Sprites = (() => {
  const RASTER = 3;
  const BASE = 'assets/sprites/';
  const NAMES = [
    'house-a', 'house-b', 'house-c', 'tower-a', 'tower-b', 'office', 'stall', 'coffee', 'factory', 'warehouse',
    'clinic', 'lab', 'workshop', 'hazard-sign', 'disposal-sign', 'depot',
    'disposal-general', 'disposal-recyclable', 'disposal-compost', 'disposal-medical', 'disposal-chemical',
    'truck-normal-se', 'truck-normal-sw', 'truck-normal-ne', 'truck-normal-nw',
    'truck-hazard-se', 'truck-hazard-sw', 'truck-hazard-ne', 'truck-hazard-nw',
  ];
  const sheet = new Map();

  function rasterise(svgText, w, h) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * RASTER; canvas.height = h * RASTER;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: canvas, autoGenerateMipmaps: true }) }));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not draw a sprite')); };
      img.src = url;
    });
  }

  async function loadOne(name) {
    const res = await fetch(BASE + name + '.svg');
    if (!res.ok) throw new Error('Missing sprite: ' + name);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    const w = +root.getAttribute('width'), h = +root.getAttribute('height');
    const entry = { w, h, ax: +root.getAttribute('data-ax'), ay: +root.getAttribute('data-ay'), day: null, lights: null };

    const group = root.querySelector('g.lights');
    const ser = new XMLSerializer();
    if (group) {
      const lit = root.cloneNode(false);
      lit.appendChild(group.cloneNode(true));
      entry.lights = await rasterise(ser.serializeToString(lit), w, h);
      group.remove();
    }
    entry.day = await rasterise(ser.serializeToString(root), w, h);
    sheet.set(name, entry);
  }

  async function load() {
    await Promise.all(NAMES.map(loadOne));
  }

  // A sprite standing with its art's ground origin on the container's (0,0).
  function make(name, kind = 'day') {
    const e = sheet.get(name);
    const s = new PIXI.Sprite(kind === 'lights' ? e.lights : e.day);
    s.anchor.set(e.ax / e.w, e.ay / e.h);
    s.width = e.w; s.height = e.h;
    return s;
  }

  const info = (name) => sheet.get(name);

  return { load, make, info };
})();
