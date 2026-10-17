/**
 * Agrandissement des images (PNG, JPG, WebP…) sur la carte graphique.
 *
 * Une image en pixels ne contient pas de détail au-delà de sa résolution, mais
 * la façon de l'agrandir change beaucoup le résultat. Foundry mélange simplement
 * les 4 pixels voisins (bilinéaire) : c'est flou, avec des contours en escalier.
 *
 * Ce filtre suit le principe d'AMD FSR 1 (EASU) : il estime localement la
 * direction des contours, puis applique un noyau de type Lanczos étiré le long
 * du contour et resserré en travers. Les bords restent nets et lisses, les
 * aplats restent doux. Le résultat est borné par les 4 pixels voisins, ce qui
 * évite les halos clairs ou sombres autour des traits.
 */

const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aSrc;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vSrc;
void main() {
  vSrc = aSrc;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 vSrc;            // position dans l'image source, en pixels
uniform sampler2D uSampler;
uniform vec2 uTexSize;        // taille réelle de la texture, en pixels
uniform vec4 uClamp;          // centres des pixels extrêmes autorisés (bords de l'image)
uniform float uSharpness;     // 0 = doux, 1 = net (réglage FSR d'origine)
uniform float uDenoise;       // 0 = aucun, 1 = lissage fort des faibles variations (grain, compression)

vec4 tap(vec2 p) {
  return texture2D(uSampler, clamp(p, uClamp.xy, uClamp.zw) / uTexSize);
}

float luma(vec4 c) {
  return c.r * 0.5 + c.g + c.b * 0.5;
}

// Contribution d'un pixel central à la direction et à la force du contour.
void edge(inout vec2 dir, inout float len, float w,
          float up, float left, float mid, float right, float down) {
  float dc = right - mid;
  float cb = mid - left;
  float m = max(abs(dc), abs(cb));
  float dirX = right - left;
  float lenX = m > 0.0 ? clamp(abs(dirX) / m, 0.0, 1.0) : 0.0;
  dir.x += dirX * w;
  len += lenX * lenX * w;

  float ec = down - mid;
  float ca = mid - up;
  m = max(abs(ec), abs(ca));
  float dirY = down - up;
  float lenY = m > 0.0 ? clamp(abs(dirY) / m, 0.0, 1.0) : 0.0;
  dir.y += dirY * w;
  len += lenY * lenY * w;
}

void accumulate(inout vec4 acc, inout float accW, vec2 off, vec2 dir, vec2 len2,
                float lob, float clp, vec4 color) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x) * len2;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  acc += color * w;
  accW += w;
}

void main() {
  vec2 pp = vSrc - 0.5;
  vec2 fp = floor(pp);
  vec2 f = pp - fp;          // position dans le carré formé par les 4 pixels centraux
  vec2 c = fp + 0.5;          // centre du pixel en haut à gauche de ce carré

  //       b c
  //     e F g h
  //     i j k l
  //       n o
  vec4 tb = tap(c + vec2( 0.0, -1.0));
  vec4 tc = tap(c + vec2( 1.0, -1.0));
  vec4 te = tap(c + vec2(-1.0,  0.0));
  vec4 tf = tap(c);
  vec4 tg = tap(c + vec2( 1.0,  0.0));
  vec4 th = tap(c + vec2( 2.0,  0.0));
  vec4 ti = tap(c + vec2(-1.0,  1.0));
  vec4 tj = tap(c + vec2( 0.0,  1.0));
  vec4 tk = tap(c + vec2( 1.0,  1.0));
  vec4 tl = tap(c + vec2( 2.0,  1.0));
  vec4 tn = tap(c + vec2( 0.0,  2.0));
  vec4 to = tap(c + vec2( 1.0,  2.0));

  float lb = luma(tb), lc = luma(tc), le = luma(te), lf = luma(tf), lg = luma(tg), lh = luma(th);
  float li = luma(ti), lj = luma(tj), lk = luma(tk), ll = luma(tl), ln = luma(tn), lo = luma(to);

  // Direction du contour, moyenne pondérée sur les 4 pixels centraux.
  vec2 dir = vec2(0.0);
  float len = 0.0;
  edge(dir, len, (1.0 - f.x) * (1.0 - f.y), lb, le, lf, lg, lj);
  edge(dir, len, f.x * (1.0 - f.y),         lc, lf, lg, lh, lk);
  edge(dir, len, (1.0 - f.x) * f.y,         lf, li, lj, lk, ln);
  edge(dir, len, f.x * f.y,                 lg, lj, lk, ll, lo);

  float dirR = dot(dir, dir);
  bool noEdge = dirR < 1.0 / 32768.0;
  dir = noEdge ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);

  len *= 0.5;
  len *= len;

  // Noyau étiré le long du contour, resserré en travers.
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + (0.21 - 0.5) * len * uSharpness;
  float clp = 1.0 / lob;

  vec4 acc = vec4(0.0);
  float accW = 0.0;
  accumulate(acc, accW, vec2( 0.0, -1.0) - f, dir, len2, lob, clp, tb);
  accumulate(acc, accW, vec2( 1.0, -1.0) - f, dir, len2, lob, clp, tc);
  accumulate(acc, accW, vec2(-1.0,  1.0) - f, dir, len2, lob, clp, ti);
  accumulate(acc, accW, vec2( 0.0,  1.0) - f, dir, len2, lob, clp, tj);
  accumulate(acc, accW, vec2( 0.0,  0.0) - f, dir, len2, lob, clp, tf);
  accumulate(acc, accW, vec2(-1.0,  0.0) - f, dir, len2, lob, clp, te);
  accumulate(acc, accW, vec2( 1.0,  1.0) - f, dir, len2, lob, clp, tk);
  accumulate(acc, accW, vec2( 2.0,  1.0) - f, dir, len2, lob, clp, tl);
  accumulate(acc, accW, vec2( 2.0,  0.0) - f, dir, len2, lob, clp, th);
  accumulate(acc, accW, vec2( 1.0,  0.0) - f, dir, len2, lob, clp, tg);
  accumulate(acc, accW, vec2( 1.0,  2.0) - f, dir, len2, lob, clp, to);
  accumulate(acc, accW, vec2( 0.0,  2.0) - f, dir, len2, lob, clp, tn);

  // Anti-halo : le résultat reste entre le min et le max des 4 pixels voisins.
  vec4 lo4 = min(min(tf, tg), min(tj, tk));
  vec4 hi4 = max(max(tf, tg), max(tj, tk));
  vec4 color = clamp(acc / accW, lo4, hi4);

  // Réduction du grain : là où les 4 pixels voisins varient peu (bruit de compression,
  // grain), FSR prendrait ces variations pour des détails et les renforcerait. On y
  // revient à une interpolation simple, qui lisse au lieu d'accentuer.
  if (uDenoise > 0.0) {
    float contrast = max(max(lf, lg), max(lj, lk)) - min(min(lf, lg), min(lj, lk));
    float t = uDenoise;  // seuil de contraste (luminance de 0 à 2)
    float keep = smoothstep(0.25 * t, t, contrast);
    vec4 smooth4 = mix(mix(tf, tg, f.x), mix(tj, tk, f.x), f.y);
    color = mix(smooth4, color, keep);
  }
  gl_FragColor = color;
}`;

/** Extensions d'images prises en charge (les vidéos sont exclues). */
const RASTER_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif"];

/**
 * Teste si une URL (ou data URI) désigne une image en pixels.
 * @param {string} src
 */
export function isRasterSource(src) {
  if (typeof src !== "string" || !src) return false;
  if (/^data:image\/(png|jpe?g|webp|avif)/i.test(src)) return true;
  const ext = src.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  return RASTER_EXTENSIONS.includes(ext);
}

/**
 * Dessine des portions agrandies d'une texture dans des RenderTextures.
 */
export class EdgeUpscaler {
  #shader = null;
  #mesh = null;
  #geometry = null;

  #ensure() {
    if (this.#mesh && !this.#mesh.destroyed) return;
    this.#geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new PIXI.Buffer(new Float32Array(8), false), 2)
      .addAttribute("aSrc", new PIXI.Buffer(new Float32Array(8), false), 2)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    this.#shader = PIXI.Shader.from(VERTEX, FRAGMENT, {
      uSampler: PIXI.Texture.EMPTY,
      uTexSize: new Float32Array([1, 1]),
      uClamp: new Float32Array([0, 0, 1, 1]),
      uSharpness: 1,
      uDenoise: 0
    });
    this.#mesh = new PIXI.Mesh(this.#geometry, this.#shader);
    this.#mesh.state.blend = false; // on écrit les valeurs telles quelles (alpha prémultiplié)
  }

  /**
   * Agrandit une zone de la texture source dans une RenderTexture.
   * @param {PIXI.Renderer} renderer
   * @param {PIXI.Texture} source        Texture d'origine (Foundry)
   * @param {{x:number, y:number, w:number, h:number}} rect  Zone source, en pixels de l'image
   * @param {PIXI.RenderTexture} target  Destination (taille = taille de sortie)
   * @param {number} sharpness           0 (doux) à 1 (net)
   * @param {number} denoise             0 (aucun) à 1 (fort)
   */
  render(renderer, source, rect, target, sharpness, denoise = 0) {
    this.#ensure();
    const base = source.baseTexture;
    const res = base.resolution || 1;
    const frame = source.frame;
    const texW = base.realWidth, texH = base.realHeight;

    // Coordonnées en pixels réels de la texture (gère les atlas et la résolution).
    const fx = frame.x * res, fy = frame.y * res;
    const fw = frame.width * res, fh = frame.height * res;
    const kx = fw / source.orig.width, ky = fh / source.orig.height;
    const x0 = fx + rect.x * kx, y0 = fy + rect.y * ky;
    const x1 = x0 + rect.w * kx, y1 = y0 + rect.h * ky;
    const w = target.width, h = target.height;

    this.#geometry.getBuffer("aVertexPosition").update(new Float32Array([0, 0, w, 0, w, h, 0, h]));
    this.#geometry.getBuffer("aSrc").update(new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]));

    const u = this.#shader.uniforms;
    u.uSampler = source;
    u.uTexSize[0] = texW;
    u.uTexSize[1] = texH;
    u.uClamp[0] = fx + 0.5;
    u.uClamp[1] = fy + 0.5;
    u.uClamp[2] = fx + fw - 0.5;
    u.uClamp[3] = fy + fh - 0.5;
    u.uSharpness = sharpness;
    u.uDenoise = denoise;

    renderer.render(this.#mesh, { renderTexture: target, clear: true });
  }

  destroy() {
    this.#mesh?.destroy({ children: true });
    this.#shader?.destroy?.();
    this.#mesh = this.#shader = this.#geometry = null;
  }
}
