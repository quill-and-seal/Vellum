/**
 * Cartes géantes découpées en pyramide de tuiles (format Deep Zoom), produites
 * par tools/vellum-tiles.py. Le fond de scène est un aperçu « carte.vellum.webp » ;
 * la pyramide « carte.xml » (ou « carte.dzi ») + « carte_files/ » est à côté.
 */
import { TILE_SIZE } from "./constants.mjs";

const PREVIEW = /\.vellum\.(webp|png|jpe?g|avif)(?=[?#]|$)/i;

/** Teste si une URL désigne un aperçu de carte découpée. */
export function isPyramidPreview(src) {
  return typeof src === "string" && PREVIEW.test(src);
}

const cache = new Map();

/**
 * Lit la description de la pyramide associée à un aperçu.
 * @param {string} src  URL de l'aperçu
 * @returns {Promise<{width:number, height:number, maxLevel:number, format:string, base:string}>}
 */
export function loadPyramid(src) {
  if (!cache.has(src)) {
    const promise = (async () => {
      const clean = src.split(/[?#]/)[0];
      // Paramètre de version de l'aperçu (« ?v=… ») : repris pour la description et les tuiles,
      // pour qu'une carte réexportée sous le même nom ne montre pas d'anciennes tuiles en cache.
      const query = src.split("#")[0].split("?")[1] ?? "";
      // Description : « carte.xml » (Foundry refuse d'envoyer les .dzi), ou « carte.dzi » (outil
      // vellum-tiles.py, ou copie faite à la main).
      const stem = clean.replace(PREVIEW, "");
      let dzi = null, response = null;
      for (const ext of [".xml", ".dzi"]) {
        const url = stem + ext;
        const res = await fetch(query ? `${url}?${query}` : url).catch(() => null);
        if (res?.ok) { dzi = url; response = res; break; }
      }
      if (!response) throw new Error(`${stem}.xml / .dzi : introuvable`);
      const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
      const image = doc.querySelector("Image");
      const size = doc.querySelector("Size");
      const tileSize = Number(image?.getAttribute("TileSize"));
      const overlap = Number(image?.getAttribute("Overlap"));
      const format = image?.getAttribute("Format");
      const width = Number(size?.getAttribute("Width"));
      const height = Number(size?.getAttribute("Height"));
      if (!(width > 0 && height > 0) || !format) throw new Error(`${dzi} : fichier invalide`);
      if (tileSize !== TILE_SIZE || overlap !== 0) {
        throw new Error(`${dzi} : tuiles de ${tileSize} px avec recouvrement ${overlap} ; Vellum attend ${TILE_SIZE} px sans recouvrement (utilisez tools/vellum-tiles.py)`);
      }
      return {
        width, height, format,
        maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
        base: `${stem}_files/`,
        query
      };
    })();
    promise.catch(() => cache.delete(src));
    cache.set(src, promise);
  }
  return cache.get(src);
}

export function clearPyramidCache() {
  cache.clear();
}

/** Taille de l'image entière à un niveau de la pyramide. */
export function levelSize(pyramid, level) {
  const k = 2 ** (pyramid.maxLevel - level);
  return { width: Math.ceil(pyramid.width / k), height: Math.ceil(pyramid.height / k) };
}

export function tileUrl(pyramid, level, i, j) {
  const url = `${pyramid.base}${level}/${i}_${j}.${pyramid.format}`;
  return pyramid.query ? `${url}?${pyramid.query}` : url;
}
