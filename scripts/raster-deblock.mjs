/**
 * Dé-blocage des images JPG.
 *
 * Le JPG compresse l'image par blocs de 8×8 pixels. Très compressé, chaque bloc
 * prend une teinte légèrement différente : des carrés apparaissent dès qu'on
 * zoome. Ce filtre repère les petites marches de couleur aux frontières des
 * blocs, entre deux zones presque unies, et les remplace par un dégradé sur
 * 3 pixels de chaque côté. Les vrais contours, plus contrastés ou situés dans
 * une zone détaillée, ne sont pas touchés.
 */

const BLOCK = 8;

/** Au-delà de ce rapport, l'image a une grille de compression visible. */
const BLOCKINESS_THRESHOLD = 1.1;

/**
 * Mesure si les sauts de couleur sont plus forts aux frontières des blocs de
 * 8 px qu'ailleurs. ≈ 1 pour une image propre, 1,1 à 2 pour un JPG compressé.
 * Lit 48 lignes et 48 colonnes seulement, pour rester rapide sur les grandes cartes.
 * @param {CanvasImageSource} source
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
export function measureBlockiness(source, width, height) {
  const samples = 48;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const line = (sx, sy, sw, sh) => {
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh).data;
  };
  let on = 0, onN = 0, off = 0, offN = 0;
  const accumulate = (data, n) => {
    for (let i = 1; i < n; i++) {
      const a = (i - 1) * 4, b = i * 4;
      const d = Math.abs(data[b] - data[a]) + Math.abs(data[b + 1] - data[a + 1]) + Math.abs(data[b + 2] - data[a + 2]);
      if (i % BLOCK === 0) { on += d; onN++; } else { off += d; offN++; }
    }
  };
  for (let k = 0; k < samples; k++) {
    const y = Math.floor((k + 0.5) * height / samples);
    const x = Math.floor((k + 0.5) * width / samples);
    accumulate(line(0, y, width, 1), width);
    accumulate(line(x, 0, 1, height), height);
  }
  canvas.width = canvas.height = 0;
  if (!onN || !offN || off === 0) return 1;
  return (on / onN) / (off / offN);
}

export const isBlocky = ratio => ratio >= BLOCKINESS_THRESHOLD;

const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPos;
void main() {
  vPos = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 vPos;            // position en pixels de l'image
uniform sampler2D uSampler;
uniform vec2 uSize;           // taille de l'image en pixels
uniform vec4 uFrame;          // position et taille de l'image dans sa texture (en UV)
uniform float uAlpha;         // marche maximale traitée comme un défaut de compression
uniform float uBeta;          // variation maximale à l'intérieur d'un bloc « uni »

vec4 px(vec2 p) {
  p = clamp(p, vec2(0.0), uSize - 1.0);
  return texture2D(uSampler, uFrame.xy + (p + 0.5) / uSize * uFrame.zw);
}

float maxAbs(vec4 v) {
  return max(max(abs(v.r), abs(v.g)), abs(v.b));
}

// Correction le long d'un axe. p = pixel courant, axis = (1,0) ou (0,1),
// pos = coordonnée du pixel sur cet axe.
vec4 fix(vec2 p, vec2 axis, float pos) {
  float b = mod(pos, ${BLOCK}.0);
  float boundary;     // premier pixel du bloc de droite / du bas
  float k;            // distance du pixel à la frontière (0 = pixel adjacent)
  float side;         // +1 côté gauche/haut, -1 côté droite/bas
  if (b < 3.0) { boundary = pos - b; k = b; side = -1.0; }
  else if (b > ${BLOCK - 4}.0) { boundary = pos - b + ${BLOCK}.0; k = ${BLOCK - 1}.0 - b; side = 1.0; }
  else return vec4(0.0);
  if (boundary <= 0.0 || boundary >= (axis.x > 0.5 ? uSize.x : uSize.y)) return vec4(0.0);

  vec2 base = p - axis * pos;
  vec4 a0 = px(base + axis * (boundary - 1.0));
  vec4 a1 = px(base + axis * (boundary - 2.0));
  vec4 b0 = px(base + axis * boundary);
  vec4 b1 = px(base + axis * (boundary + 1.0));
  vec4 d = b0 - a0;
  if (maxAbs(d) > uAlpha || maxAbs(a0 - a1) > uBeta || maxAbs(b1 - b0) > uBeta) return vec4(0.0);
  return side * d * (3.0 - k) / 8.0;
}

void main() {
  vec2 p = floor(vPos);
  vec4 c = px(p);
  c += fix(p, vec2(1.0, 0.0), p.x);
  c += fix(p, vec2(0.0, 1.0), p.y);
  gl_FragColor = clamp(c, 0.0, 1.0);
}`;

/**
 * Produit une copie dé-bloquée d'une texture, à sa taille d'origine, avec mipmaps.
 * @param {PIXI.Renderer} renderer
 * @param {PIXI.Texture} source
 * @param {number} strength  0 à 1
 * @returns {PIXI.RenderTexture}
 */
export function deblockTexture(renderer, source, strength) {
  const w = Math.round(source.orig.width), h = Math.round(source.orig.height);
  const base = source.baseTexture;
  const frame = source.frame, bw = base.width, bh = base.height;

  const geometry = new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, w, 0, w, h, 0, h], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const shader = PIXI.Shader.from(VERTEX, FRAGMENT, {
    uSampler: source,
    uSize: new Float32Array([w, h]),
    uFrame: new Float32Array([frame.x / bw, frame.y / bh, frame.width / bw, frame.height / bh]),
    uAlpha: 0.04 + 0.12 * strength,
    uBeta: 0.02 + 0.06 * strength
  });
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.state.blend = false;

  const rt = PIXI.RenderTexture.create({ width: w, height: h, resolution: 1 });
  renderer.render(mesh, { renderTexture: rt, clear: true });
  mesh.destroy({ children: true });
  geometry.destroy();
  shader.destroy?.();

  // Versions réduites pour le dézoom (anti-scintillement), générées après le rendu.
  if (PIXI.MIPMAP_MODES && renderer.context?.webGLVersion === 2) {
    const gl = renderer.gl;
    rt.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    renderer.texture.bind(rt.baseTexture, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    renderer.texture.unbind(rt.baseTexture);
  }
  return rt;
}
