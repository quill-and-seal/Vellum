/**
 * Préchargement d'une scène chez les joueurs, sans l'afficher : en un clic (menu des scènes),
 * le MJ lance le préchargement natif de Foundry (fond, tuiles) et demande en plus à chaque
 * joueur de télécharger en silence :
 *  - les premiers niveaux des cartes découpées (ceux du zoom habituel), gardés compressés en
 *    mémoire jusqu'à leur premier affichage ;
 *  - les images que d'autres modules déclarent via le hook « vellumPreload » (par exemple les
 *    arbres de Cadastre), mises dans le cache de textures de Foundry.
 * Chaque joueur répond quand il a fini : le MJ voit qui est prêt.
 */
import { MODULE_ID, TILE_SIZE } from "./constants.mjs";
import { isPyramidPreview, loadPyramid, levelSize, tileUrl } from "./pyramid.mjs";

const SOCKET = `module.${MODULE_ID}`;
/** Tuiles préchargées au plus par carte découpée (≈ 50 ko chacune). */
const MAX_TILES = 400;
/** Niveaux préchargés : jusqu'à ce facteur au-dessus de la taille de la scène (zoom ×1,6). */
const MAX_ZOOM = 1.6;
const PARALLEL = 6;
/** Délai au-delà duquel le MJ ne compte plus les joueurs qui n'ont pas répondu. */
const ANSWER_TIMEOUT = 120_000;

/** URL de tuile → Blob téléchargé d'avance (rendu au premier affichage). */
const tileCache = new Map();
let cachedScene = null;

/**
 * Tuile préchargée, si elle l'a été : URL locale (blob:) à utiliser à la place de l'URL de la
 * tuile, et fonction à appeler une fois l'image chargée. Le blob n'est rendu qu'une fois.
 * @returns {{url:string, release:()=>void}|null}
 */
export function takePreloadedTile(url) {
  const blob = tileCache.get(url);
  if (!blob) return null;
  tileCache.delete(url);
  const local = URL.createObjectURL(blob);
  return { url: local, release: () => URL.revokeObjectURL(local) };
}

/** Images affichées par une scène : fonds (scène et niveaux v14) et tuiles. */
function sceneImages(scene) {
  const out = new Set();
  const add = (src) => { if (typeof src === "string" && src) out.add(src); };
  add(scene.background?.src);
  add(scene.foreground);
  for (const level of scene.levels?.contents ?? []) {
    add(level.background?.src);
    add(level.foreground?.src);
  }
  for (const tile of scene.tiles?.contents ?? []) add(tile.texture?.src);
  return [...out];
}

/** Tuiles des niveaux du zoom habituel d'une carte découpée, des plus grossiers aux plus fins. */
async function pyramidTiles(src, sceneWidth) {
  const pyramid = await loadPyramid(src);
  const urls = [];
  for (let level = 0; level <= pyramid.maxLevel; level++) {
    const { width, height } = levelSize(pyramid, level);
    if (level > 0 && sceneWidth > 0 && width > sceneWidth * MAX_ZOOM) break;
    const cols = Math.ceil(width / TILE_SIZE), rows = Math.ceil(height / TILE_SIZE);
    if (urls.length + cols * rows > MAX_TILES && urls.length) break;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) urls.push(tileUrl(pyramid, level, i, j));
  }
  return urls;
}

async function fetchAll(urls, onBlob) {
  let next = 0, ok = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        onBlob?.(url, await res.blob());
        ok++;
      } catch { /* tuile absente : elle sera chargée à la demande */ }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return ok;
}

/** Préchargement chez ce client (joueur ou MJ). */
export async function preloadHere(sceneId) {
  const scene = game.scenes.get(sceneId);
  if (!scene) return { tiles: 0, extra: 0 };
  if (cachedScene !== sceneId) { tileCache.clear(); cachedScene = sceneId; }

  // Images déclarées par les autres modules : dans le cache de textures de Foundry.
  const extra = new Set();
  Hooks.callAll("vellumPreload", scene, (src) => { if (typeof src === "string" && src) extra.add(src); });
  const loader = foundry.canvas?.TextureLoader?.loader ?? globalThis.TextureLoader?.loader;
  const extraDone = extra.size && loader
    ? loader.load([...extra], { displayProgress: false }).then(() => extra.size, () => 0)
    : Promise.resolve(0);

  // Cartes découpées : premiers niveaux, gardés compressés.
  let tiles = 0;
  for (const src of sceneImages(scene).filter(isPyramidPreview)) {
    try {
      const urls = await pyramidTiles(src, scene.width ?? scene.dimensions?.sceneWidth ?? 0);
      tiles += await fetchAll(urls.filter((u) => !tileCache.has(u)), (url, blob) => tileCache.set(url, blob));
    } catch (error) {
      console.warn(`${MODULE_ID} | Préchargement de ${src} impossible`, error);
    }
  }
  return { tiles, extra: await extraDone };
}

/* -------------------------------------------- */
/*  Côté MJ                                     */
/* -------------------------------------------- */

const requests = new Map();

/** Précharge une scène chez tous les joueurs connectés, sans la leur afficher. */
export async function preloadForPlayers(sceneId) {
  const scene = game.scenes.get(sceneId);
  if (!scene || !game.user.isGM) return;
  // Préchargement natif de Foundry (fond et tuiles), poussé à tous les clients.
  try { await game.scenes.preload(sceneId, true); } catch (error) { console.warn(`${MODULE_ID} | Préchargement natif impossible`, error); }

  const players = game.users.filter((u) => u.active && u.id !== game.user.id);
  const id = foundry.utils.randomID();
  const note = ui.notifications?.info(game.i18n.format("VELLUM.Preload.Started", { scene: scene.name, total: players.length }), { progress: true, permanent: true });
  const req = { id, scene, total: players.length, done: new Map(), note, finish: null };
  requests.set(id, req);
  const finished = new Promise((resolve) => { req.finish = resolve; });
  game.socket.emit(SOCKET, { type: "preload", id, sceneId });

  // Le MJ précharge aussi chez lui.
  const mine = preloadHere(sceneId).catch(() => null);
  const timer = setTimeout(() => req.finish(), ANSWER_TIMEOUT);
  if (!players.length) req.finish();
  await Promise.all([finished, mine]);
  clearTimeout(timer);
  requests.delete(id);

  const ready = req.done.size;
  const message = game.i18n.format(ready >= req.total ? "VELLUM.Preload.Done" : "VELLUM.Preload.Partial", {
    scene: scene.name, ready, total: req.total,
    missing: players.filter((u) => !req.done.has(u.id)).map((u) => u.name).join(", ")
  });
  if (typeof note?.update === "function") note.update({ pct: 1, message });
  else ui.notifications?.info(message);
  setTimeout(() => note?.remove?.(), 6000);
}

function onAnswer({ id, userId, tiles }) {
  const req = requests.get(id);
  if (!req) return;
  req.done.set(userId, tiles);
  const message = game.i18n.format("VELLUM.Preload.Progress", { scene: req.scene.name, ready: req.done.size, total: req.total });
  if (typeof req.note?.update === "function") req.note.update({ pct: req.done.size / Math.max(1, req.total), message });
  if (req.done.size >= req.total) req.finish();
}

/* -------------------------------------------- */
/*  Branchements                                */
/* -------------------------------------------- */

export function registerPreload() {
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (msg) => {
      if (msg?.type === "preload") {
        const result = await preloadHere(msg.sceneId).catch(() => ({ tiles: 0 }));
        game.socket.emit(SOCKET, { type: "preloaded", id: msg.id, userId: game.user.id, tiles: result.tiles });
      } else if (msg?.type === "preloaded" && game.user.isGM) {
        onAnswer(msg);
      }
    });
  });

  // Entrée de menu (clic droit) sur les scènes : liste des scènes et barre de navigation.
  const entry = (idOf) => ({
    name: "VELLUM.Preload.Menu",
    icon: '<i class="fa-solid fa-cloud-arrow-down"></i>',
    condition: () => game.user.isGM,
    callback: (li) => preloadForPlayers(idOf(li))
  });
  const el = (li) => (li instanceof HTMLElement ? li : li?.[0]);
  const fromDirectory = (li) => el(li)?.dataset.entryId ?? el(li)?.dataset.documentId;
  const fromNavigation = (li) => el(li)?.dataset.sceneId ?? el(li)?.dataset.documentId;
  const add = (options, idOf) => {
    if (Array.isArray(options) && !options.some((o) => o?.name === "VELLUM.Preload.Menu")) options.push(entry(idOf));
  };
  // Selon la version de Foundry, le hook et la forme des options changent.
  for (const hook of ["getSceneContextOptions", "getSceneDirectoryEntryContext"]) {
    Hooks.on(hook, (app, options) => add(options, fromDirectory));
  }
  for (const hook of ["getSceneNavigationContext", "getSceneNavigationContextOptions"]) {
    Hooks.on(hook, (app, options) => add(options, fromNavigation));
  }
}
