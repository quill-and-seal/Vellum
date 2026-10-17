# Changelog

## 0.3.1

### Corrections
- **Grain sur les images compressées** : le filtre d'agrandissement accentuait le bruit de compression (JPG, WebP) dans les zones unies et autour des traits. Dans les zones à faible contraste, il revient désormais à une interpolation simple, qui lisse au lieu d'accentuer.
- Nouveau réglage **Réduction du grain** (0,6 par défaut) pour doser ce compromis entre netteté et grain.

## 0.3.0

### Nouveautés
- **Lissage des images** (PNG, JPG, WebP, AVIF) pour les fonds de scène et les tuiles :
  - au zoom, au-delà de la résolution de l'image, agrandissement par un filtre GPU qui suit les contours (principe d'AMD FSR 1), sans halo, calculé par tuiles gardées en cache ;
  - au dézoom, mipmaps activées pour supprimer le scintillement des traits fins.
- Nouveaux réglages : **Lissage des images** et **Netteté du lissage**.
- `inspect()` indique le type de chaque objet suivi (SVG ou image).

### Changements
- Les jetons et les tuiles qui s'estompent au passage d'un jeton (toits) ne sont plus traités, SVG compris : le calque de Vellum ne suivait pas leurs effets.
- Le dépôt a déménagé dans l'organisation GitHub quill-and-seal : liens du manifeste mis à jour.

## 0.2.1

### Améliorations
- **Zone visible rendue par tuiles** de 512 px, comme sur une carte en ligne, pour supprimer les saccades au zoom et au déplacement :
  - les tuiles sont gardées en cache sur la carte graphique : en se déplaçant, seules les nouvelles tuiles en bordure sont calculées, et revenir sur une zone déjà vue est instantané ;
  - les tuiles manquantes sont dessinées une par une, du centre de l'écran vers les bords, sans bloquer l'interface ;
  - niveaux de zoom fixes (×2, ×4, ×8…) : zoomer à l'intérieur d'un même niveau ne déclenche aucun calcul ;
  - envois vers la carte graphique par petits morceaux (0,3 Mpx au lieu de plusieurs Mpx d'un coup).
- Sur un parcours de test (déplacement, zoom ×8 → ×16, retour), environ 2 à 3 fois moins de temps de dessin et 4 fois moins de données envoyées au GPU qu'en 0.2.0.
- `inspect()` affiche le niveau de zoom de la zone et l'état du cache de tuiles.

## 0.2.0

### Nouveautés
- **Rendu en deux couches** : un fond de base de la carte entière, rendu une seule fois au chargement, et un rendu haute résolution limité à la zone visible, posé par-dessus. Net à tous les zooms, quelle que soit la taille de la carte.
- **Fluidité** : les rendus sont découpés en morceaux et étalés sur plusieurs images au lieu de figer l'interface ; une marge autour de la zone visible évite tout recalcul lors des petits déplacements.
- **Optimisation automatique des flous** : les calques floutés (ombrage de relief, halos) sont pré-calculés une seule fois en image, à leur place exacte. Sur une carte de test, le rendu d'une zone est environ deux fois plus rapide, pour un résultat visuellement identique.
- **Fond de base partagé** entre les objets qui affichent le même SVG.
- Nouveau réglage : **résolution du fond de base** (2048, 4096 ou 8192 px).

### Changements
- Le budget mémoire porte désormais sur la zone visible (32 Mpx par défaut au lieu de 64).
- Le SVG n'est lu et décodé qu'une seule fois par session.
- `inspect()` affiche le fond de base et la zone visible de chaque SVG.

### Corrections
- Les textures d'origine de Foundry sont restaurées avant le démontage d'une scène.

## 0.1.1

- Correction : points et petits traits colorés parasites sur certaines cartes graphiques. Le SVG est désormais rasterisé en mémoire CPU avant d'être envoyé au GPU, et les mipmaps sont désactivées pour les textures Vellum.

## 0.1.0

- Première version.
- Détection automatique des fonds de scène et tuiles au format SVG.
- Re-rasterisation adaptative au zoom (rendu net à la résolution de l'écran).
- Réglages client : activation, qualité, budget mémoire, mode débogage.
- API console `game.modules.get("vellum").api` pour le diagnostic.
