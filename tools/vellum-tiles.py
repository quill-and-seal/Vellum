#!/usr/bin/env python3
"""Découpe une carte géante pour Vellum.

Produit, à côté de l'image d'origine :
  carte.dzi            description de la pyramide (format Deep Zoom)
  carte_files/         les tuiles de 512 px, de la carte entière jusqu'à 1 px
  carte.vellum.webp    un aperçu (4096 px max) à mettre en fond de scène

Usage :
  pip install "pyvips[binary]"
  python vellum-tiles.py carte.png
  python vellum-tiles.py carte.jpg --quality 85

Déposez ensuite les trois éléments ensemble dans les données de Foundry,
choisissez carte.vellum.webp comme fond de scène, et donnez à la scène les
dimensions affichées à la fin.
"""
import argparse
import pathlib
import sys

try:
    import pyvips
except ImportError:
    sys.exit('pyvips est requis : pip install "pyvips[binary]"')

TILE_SIZE = 512       # doit correspondre à TILE_SIZE dans scripts/constants.mjs
PREVIEW_SIZE = 4096


def main():
    parser = argparse.ArgumentParser(description="Découpe une carte géante en tuiles pour Vellum.")
    parser.add_argument("image", type=pathlib.Path, help="carte d'origine (PNG, JPG, WebP, TIFF…)")
    parser.add_argument("--quality", type=int, default=90, help="qualité WebP des tuiles, 1 à 100 (défaut : 90)")
    args = parser.parse_args()

    src = args.image
    if not src.is_file():
        sys.exit(f"Fichier introuvable : {src}")
    if not 1 <= args.quality <= 100:
        sys.exit("--quality doit être entre 1 et 100")

    image = pyvips.Image.new_from_file(str(src))
    width, height = image.width, image.height
    base = src.with_suffix("")
    print(f"Carte : {width} × {height} px")

    print("Découpage en tuiles…")
    image.dzsave(str(base), tile_size=TILE_SIZE, overlap=0, layout="dz",
                 suffix=f".webp[Q={args.quality}]")

    print("Aperçu…")
    preview = pyvips.Image.thumbnail(str(src), PREVIEW_SIZE, height=PREVIEW_SIZE)
    preview_path = base.with_name(base.name + ".vellum.webp")
    preview.write_to_file(f"{preview_path}[Q=90]")

    print()
    print("Terminé. Déposez ensemble dans Foundry :")
    print(f"  {base.name}.dzi")
    print(f"  {base.name}_files/")
    print(f"  {preview_path.name}   ← fond de scène")
    print(f"Dimensions de la scène à saisir : largeur {width}, hauteur {height}")


if __name__ == "__main__":
    main()
