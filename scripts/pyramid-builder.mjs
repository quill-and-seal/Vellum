/**
 * Découpage d'une carte géante directement dans Foundry.
 *
 * Le navigateur du MJ ouvre la carte, la découpe en tuiles de 512 px à tous les
 * niveaux de détail (format Deep Zoom), et envoie les fichiers au serveur Foundry
 * comme un téléversement normal :
 *   carte.dzi            description de la découpe
 *   carte_files/<n>/     les tuiles du niveau n
 *   carte.vellum.webp    aperçu de 4096 px, à mettre en fond de scène
 */
import { MODULE_ID, TILE_SIZE } from "./constants.mjs";

const PREVIEW_SIZE = 4096;
const QUALITY = 0.9;
const PARALLEL_UPLOADS = 4;

const FilePickerClass = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const DialogV2 = () => foundry.applications?.api?.DialogV2;

/** Entrée « Préparer une carte géante » des réglages : Foundry appelle render(). */
export class PyramidBuilderMenu {
  render() {
    pickAndBuild();
    return this;
  }
}

/** Choix de la carte dans les fichiers de Foundry, confirmation, puis découpage. */
export function pickAndBuild() {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("VELLUM.Builder.GMOnly"));
  const FP = FilePickerClass();
  new FP({
    type: "image",
    callback: async path => {
      const ok = await DialogV2().confirm({
        window: { title: game.i18n.localize("VELLUM.Builder.Title") },
        content: `<p>${game.i18n.format("VELLUM.Builder.Confirm", { path })}</p>`
      });
      if (ok) buildPyramid(path).catch(error => {
        console.error(`${MODULE_ID} | Découpage impossible`, error);
        ui.notifications.error(game.i18n.format("VELLUM.Builder.Failed", { error: error.message }));
      });
    }
  }).render(true);
}

/**
 * Découpe une carte et envoie la pyramide à côté d'elle.
 * @param {string} path  chemin de la carte dans les données de Foundry
 * @param {{upload?: Function, createDirectory?: Function}} [io]  pour les tests
 * @returns {Promise<{width:number, height:number, preview:string, files:number}>}
 */
export async function buildPyramid(path, io = {}) {
  const FP = FilePickerClass();
  const upload = io.upload ?? ((dir, file) => FP.upload("data", dir, file, {}, { notify: false }));
  const mkdir = io.createDirectory ?? (async dir => {
    try { await FP.createDirectory("data", dir); } catch { /* existe déjà */ }
  });

  const clean = decodeURI(path.split(/[?#]/)[0]);
  const slash = clean.lastIndexOf("/");
  const dir = slash >= 0 ? clean.slice(0, slash) : "";
  const name = clean.slice(slash + 1).replace(/\.[^.]+$/, "");
  const join = (...parts) => parts.filter(Boolean).join("/");

  const progress = startProgress(game.i18n.format("VELLUM.Builder.Loading", { name }));
  // createImageBitmap décode les très grandes images (testé à 32 000 × 12 800 px),
  // là où img.decode() échoue au-delà de quelques milliers de pixels.
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const { width, height } = bitmap;

  try {
    const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
    const canvas = document.createElement("canvas");
    // Canvas en mémoire CPU : une texture GPU ne pourrait pas contenir la carte entière.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const encode = async () => {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", QUALITY));
      if (!blob) throw new Error("encodage impossible");
      return blob;
    };
    const draw = (sx, sy, sw, sh, w, h) => {
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    };

    // Format réel produit par le navigateur (Safari ne sait pas encoder le WebP).
    draw(0, 0, 1, 1, 1, 1);
    const format = (await encode()).type === "image/webp" ? "webp" : "png";
    const fileType = `image/${format}`;

    const levels = [];
    let total = 0;
    for (let level = maxLevel; level >= 0; level--) {
      const k = 2 ** (maxLevel - level);
      const lw = Math.ceil(width / k), lh = Math.ceil(height / k);
      const cols = Math.ceil(lw / TILE_SIZE), rows = Math.ceil(lh / TILE_SIZE);
      levels.push({ level, k, lw, lh, cols, rows });
      total += cols * rows;
    }

    const filesDir = join(dir, `${name}_files`);
    await mkdir(filesDir);
    let done = 0;
    const pending = new Set();
    const send = async (target, file) => {
      while (pending.size >= PARALLEL_UPLOADS) await Promise.race(pending);
      const p = upload(target, file).finally(() => pending.delete(p));
      pending.add(p);
    };

    for (const { level, k, lw, lh, cols, rows } of levels) {
      const levelDir = join(filesDir, String(level));
      await mkdir(levelDir);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const w = Math.min(TILE_SIZE, lw - i * TILE_SIZE);
          const h = Math.min(TILE_SIZE, lh - j * TILE_SIZE);
          // Zone correspondante dans la carte d'origine (bornée aux bords).
          const sx = i * TILE_SIZE * k, sy = j * TILE_SIZE * k;
          draw(sx, sy, Math.min(w * k, width - sx), Math.min(h * k, height - sy), w, h);
          const blob = await encode();
          await send(levelDir, new File([blob], `${i}_${j}.${format}`, { type: fileType }));
          done++;
          if (done % 8 === 0) progress.update(done / (total + 2), game.i18n.format("VELLUM.Builder.Progress", { done, total }));
        }
      }
    }
    await Promise.all(pending);

    // Aperçu pour le fond de scène.
    const s = Math.min(1, PREVIEW_SIZE / Math.max(width, height));
    draw(0, 0, width, height, Math.round(width * s), Math.round(height * s));
    const previewName = `${name}.vellum.${format}`;
    await upload(dir, new File([await encode()], previewName, { type: fileType }));

    const dzi = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="${format}" Overlap="0" TileSize="${TILE_SIZE}">
  <Size Width="${width}" Height="${height}"/>
</Image>
`;
    await upload(dir, new File([dzi], `${name}.dzi`, { type: "application/xml" }));
    canvas.width = canvas.height = 0;
    progress.update(1, game.i18n.localize("VELLUM.Builder.Done"));

    const preview = join(dir, previewName);
    DialogV2()?.prompt({
      window: { title: game.i18n.localize("VELLUM.Builder.Title") },
      content: game.i18n.format("VELLUM.Builder.Summary", { preview, width, height, files: total })
    });
    return { width, height, preview, files: total };
  } finally {
    bitmap.close();
  }
}

/** Barre de progression des notifications (Foundry v13+), ou simple journal à défaut. */
function startProgress(message) {
  const note = ui.notifications?.info(message, { progress: true, permanent: true });
  return {
    update(pct, msg) {
      if (typeof note?.update === "function") note.update({ pct, message: msg });
      else if (msg) console.log(`${MODULE_ID} | ${msg}`);
    }
  };
}
