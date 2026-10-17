# Vellum

**Des fonds de scène et des tuiles en SVG, nets à tous les niveaux de zoom, dans Foundry VTT. Et des images (PNG, WebP…) agrandies proprement.**

Le vélin était la surface lisse et sans grain des manuscrits enluminés. Vellum apporte la même chose à vos cartes : plus de pixels qui apparaissent quand vous zoomez sur un détail.

> ⚠️ **Module en développement.** Testé sur Foundry VTT v14. Retours et rapports de bugs bienvenus dans les [issues](https://github.com/quill-and-seal/Vellum/issues).

---

## Le problème

Foundry accepte déjà les fichiers `.svg` comme fond de scène ou comme tuile. Mais il les convertit **une seule fois** en image, à leur taille native, au chargement de la scène. Dès que vous zoomez au-delà de cette taille, le rendu devient flou, exactement comme avec un PNG.

## Ce que fait Vellum

Vellum affiche vos SVG en **deux couches** :

1. **Le fond de base** : la carte entière, rendue une seule fois au chargement de la scène, en 4096 px par défaut. C'est elle que vous voyez en vue d'ensemble et pendant les déplacements.
2. **La zone visible** : la portion à l'écran, assemblée à partir de **tuiles** de 512 px rendues à la résolution de votre écran et posées par-dessus. Comme sur une carte en ligne, les tuiles sont gardées en mémoire : en vous déplaçant, seules les nouvelles tuiles en bordure sont calculées, et revenir sur une zone déjà vue est instantané.

Résultat :

- **Net à tous les zooms, quelle que soit la taille de la carte**, puisqu'on ne dessine jamais que ce qui est à l'écran.
- **Fluide** : les tuiles manquantes sont dessinées une par une, en commençant par le centre de l'écran, et étalées sur plusieurs images pour ne pas figer l'interface. Les niveaux de zoom sont fixes (×2, ×4, ×8…) : zoomer à l'intérieur d'un même niveau ne déclenche aucun calcul.
- **Fidèle** : le rendu est identique à celui du SVG d'origine, au pixel près.
- **Intégré à Foundry** : éclairage, brouillard de guerre, vision et murs fonctionnent normalement, et les tuiles posées au-dessus restent au-dessus.
- **Local** : chaque joueur calcule son propre rendu selon son écran et ses réglages. Rien n'est synchronisé, rien n'est stocké dans le monde.

Fonds de scène et tuiles sont gérés de la même façon, sans configuration : il suffit d'utiliser un fichier `.svg`.

### Optimisation automatique des flous

Les filtres de flou (ombrages de relief, halos…) sont l'opération la plus coûteuse pour le navigateur : sur une carte de test, ils représentaient les trois quarts du temps de rendu. Comme un contenu flou n'a, par nature, aucun détail fin, Vellum pré-calcule chaque calque flouté une seule fois sous forme d'image, à sa place exacte dans la carte (ordre d'affichage, transformations et modes de fusion conservés). Visuellement, rien ne change.

## Images (PNG, JPG, WebP, AVIF)

Une image en pixels n'a pas de détail au-delà de sa résolution : aucun module ne la rendra aussi nette qu'un SVG. Mais la façon de l'agrandir change beaucoup le résultat. Pour les fonds et tuiles en image, Vellum :

- **au zoom**, au-delà de la résolution de l'image, remplace l'agrandissement flou de Foundry par un filtre qui suit les contours (même principe qu'AMD FSR 1) : les traits restent plus nets et moins en escalier, les aplats restent doux, sans halo autour des contours. Le calcul se fait sur la carte graphique, par tuiles gardées en cache ;
- **au dézoom**, active des versions réduites de l'image (mipmaps) pour supprimer le scintillement des traits fins.

Les JPG compressés montrent des carrés (blocs de 8×8 pixels compressés séparément). Vellum détecte automatiquement cette grille et, si elle est présente, calcule une seule fois une copie de l'image où les petites marches de couleur aux frontières des blocs deviennent des dégradés ; les vrais contours ne sont pas touchés. Les images propres (PNG, JPG de bonne qualité) ne sont pas modifiées. Le WebP compressé utilise une grille différente et n'est pas traité.

Sur les images compressées (JPG, WebP de qualité moyenne), un filtre qui renforce les contours renforce aussi le grain de compression : le réglage **Réduction du grain** lisse ces petites variations dans les zones unies, au prix d'un peu de netteté.

Le gain est surtout visible sur les contours. Une carte exportée en basse résolution reste floue de près : pour un rendu parfaitement net, exportez-la en SVG ou en plus haute résolution.

Les jetons et les tuiles qui s'estompent au passage d'un jeton (toits) ne sont pas modifiés. Les vidéos non plus.

## Installation

### Par URL de manifeste (recommandé)

Dans Foundry : **Modules complémentaires → Installer un module**, puis collez dans le champ « URL du manifeste » :

```
https://github.com/quill-and-seal/Vellum/releases/latest/download/module.json
```

### Manuellement

1. Téléchargez `module.zip` depuis la [dernière release](https://github.com/quill-and-seal/Vellum/releases/latest).
2. Décompressez-le dans `Data/modules/vellum/` de votre installation Foundry.
3. Redémarrez Foundry et activez **Vellum** dans votre monde.

## Utilisation

1. Activez le module dans votre monde.
2. Choisissez un fichier `.svg` comme fond de scène (configuration de la scène) ou comme tuile.
3. Zoomez : c'est net.

Au premier affichage d'une carte, Vellum la prépare (lecture, optimisation des flous, fond de base) : comptez une à quelques secondes pour une grosse carte. La scène reste utilisable pendant ce temps, avec l'image native de Foundry.

### Réglages

Dans **Paramètres → Configurer les paramètres → Vellum**. Ce sont des réglages **client** : chaque joueur règle Vellum selon sa machine.

| Réglage | Par défaut | Rôle |
|---|---|---|
| Activer le rendu vectoriel | Oui | Désactivé, Foundry affiche les SVG comme d'habitude. |
| Qualité | Écran (×1) | Résolution de la zone visible par rapport à l'écran. ×1,5 ou ×2 pour un rendu encore plus fin, au prix de plus de mémoire et de temps de calcul. |
| Résolution du fond de base | 4096 px | Taille de la carte entière rendue au chargement. Plus haut = vue d'ensemble plus nette, mais chargement plus long. |
| Budget mémoire de la zone visible | 32 Mpx | Mémoire vidéo réservée aux tuiles en cache et à la zone affichée (32 Mpx ≈ 128 Mo). Plus haut, plus de tuiles restent en mémoire et les allers-retours sont instantanés. À baisser sur les petites configurations. |
| Lissage des images | Oui | Agrandissement qui suit les contours et anti-scintillement pour les fonds et tuiles en image. |
| Netteté du lissage | 1 | 0 = rendu doux, 1 = contours les plus nets. Jamais de halo, quel que soit le réglage. |
| Dé-blocage (JPG) | 1 | Efface les carrés de compression des JPG (blocs de 8 px). Ne s'applique qu'aux images où une grille de compression est détectée. 0 = désactivé. |
| Réduction du grain | 0,6 | Lisse le grain et les artefacts de compression (JPG, WebP) au lieu de les accentuer. 0 = netteté maximale, 1 = aucun grain ajouté. Les vrais contours restent nets. |
| Mode débogage | Non | Affiche le détail et la durée de chaque rendu dans la console. |

## Préparer ses SVG

Pour un résultat optimal :

- **Convertissez les textes en tracés** (dans Inkscape : *Chemin → Objet en chemin*). Un SVG affiché comme image ne peut pas charger de polices externes.
- **Intégrez les images** plutôt que de les lier. Les images bitmap contenues dans le SVG restent, elles, limitées à leur propre résolution.
- **Donnez une taille au document** (`width`, `height` ou `viewBox`). C'est cette taille que Foundry utilise pour dimensionner la scène.
- **Les filtres de flou sont optimisés automatiquement** s'ils sont peu nombreux (ombrage global, halo…). Des centaines d'ombres floutées individuelles (une par arbre, par exemple) restent en vectoriel et ralentissent le rendu.

## Limites connues

- **Affichage progressif.** Après un changement de niveau de zoom ou un grand déplacement, la zone affichée se précise tuile par tuile, du centre vers les bords ; en attendant, c'est la version précédente (ou le fond de base) qui est affichée.
- **SVG très complexes.** Le temps de dessin d'une tuile dépend surtout du contenu du fichier : de l'ordre de 10 à 30 ms par tuile pour une carte de 16 Mo et 61 000 formes.
- **Navigateur.** Vellum est optimisé pour Chromium (l'application Foundry, Chrome, Edge). Sous Firefox, le rendu fonctionne mais peut être plus lent.
- **Fichiers hébergés ailleurs** (S3, autre domaine) : le serveur doit autoriser les requêtes CORS, sinon le SVG reste en résolution native.
- **Toits et jetons** : les tuiles qui s'estompent au passage d'un jeton et les jetons ne sont pas traités, le calque posé par Vellum ne suivrait pas leurs effets.

## Diagnostic

Ouvrez la console (F12) et tapez :

```js
game.modules.get("vellum").api.inspect()
```

Vous obtenez la liste des SVG détectés, avec pour chacun :

- **natif** : la taille à laquelle Foundry l'avait figé ;
- **base** : la taille du fond de base rendu par Vellum ;
- **zone** : la taille de la zone assemblée, son niveau de zoom (×2, ×4…) et la portion de la carte qu'elle couvre (« — » quand le fond de base suffit) ;
- **tuiles** : le nombre de tuiles en cache, et celles qui restent à dessiner.

Autres commandes :

```js
game.modules.get("vellum").api.refresh() // force une mise à jour
game.modules.get("vellum").api.reset()   // revient aux images natives puis recalcule tout
```

Activez le **mode débogage** dans les réglages pour voir la durée de chaque étape. En cas de bug, joignez le résultat de `inspect()` et les messages de la console à votre issue.

## Feuille de route

- [x] **0.1** — Rendu adaptatif au zoom des fonds de scène et tuiles SVG.
- [x] **0.2** — Rendu en deux couches (fond de base + zone visible), optimisation automatique des flous, fond de base partagé entre objets identiques.
- [x] **0.2.1** — Zone visible rendue par tuiles avec cache GPU, pour supprimer les saccades.
- [x] **0.3** — Lissage des images (PNG, JPG, WebP, AVIF) : agrandissement qui suit les contours et anti-scintillement.
- [ ] Mémorisation des cartes SVG préparées d'une session à l'autre, pour un chargement instantané.
- [ ] Pistes : réglages par scène, aperçu dans la configuration de la scène, prise en charge d'autres formats vectoriels.

## Fonctionnement technique

Le canvas de Foundry tourne en WebGL (via PIXI), qui ne sait afficher que des textures en pixels. Vellum :

1. parcourt le groupe primaire du canvas et repère les objets dont la texture provient d'un fichier SVG ou d'une image ;
2. charge le SVG une seule fois, le normalise (taille et `viewBox`), pré-rend ses calques floutés, puis le décode en image. Chromium garde sa version vectorielle : dessiner une portion agrandie retrace les formes à la taille demandée ;
3. rend la carte entière en fond de base et remplace la texture de Foundry par ce rendu, sans changer sa taille dans la scène ;
4. à chaque arrêt de zoom ou de déplacement, choisit le niveau de zoom (l'image entière fait la largeur du fond de base × 2, × 4, × 8…) et la liste des tuiles de 512 px qui couvrent l'écran, plus une tuile de marge ;
5. assemble sur le GPU, dans une seule texture, l'ancienne vue (en aperçu) puis les tuiles déjà en cache, et dessine les tuiles manquantes une par une, du centre vers les bords. Chaque tuile est gardée sur le GPU ; les moins récemment utilisées sont libérées au-delà du budget mémoire ;
6. pose cette texture par-dessus le fond, dans un objet du même type que la cible, inséré juste au-dessus d'elle : il est trié, éclairé et masqué comme elle. Sa position est resynchronisée à chaque image.

Pour les images, il n'y a pas de fond de base : la texture de Foundry en tient lieu, avec ses mipmaps activées. Les tuiles ne sont pas dessinées par le navigateur mais calculées sur le GPU par un shader : 12 pixels voisins, direction du contour estimée localement, noyau de type Lanczos étiré le long du contour, résultat borné par les 4 pixels voisins.

Les canvas de rendu sont gardés en mémoire CPU, ce qui évite les artefacts que certaines cartes graphiques produisent lors de la copie de très grands canvas vers WebGL. La texture d'origine de Foundry n'est jamais modifiée : désactiver Vellum la rétablit immédiatement.

### Structure du dépôt

```
module.json              Manifeste du module
scripts/
  vellum.mjs             Point d'entrée : réglages, hooks, API
  renderer.mjs           Détection des SVG, fond de base, tuiles et zone visible
  svg-rasterizer.mjs     Chargement, décodage et dessin par morceaux
  svg-optimizer.mjs      Pré-rendu des calques floutés
  raster-upscaler.mjs    Filtre d'agrandissement des images (shader GPU)
  raster-deblock.mjs     Détection de la grille JPG et dé-blocage (shader GPU)
  constants.mjs          Seuils et paramètres internes
lang/                    Traductions (français, anglais)
.github/workflows/       Publication automatique des releases
```

### Publier une nouvelle version

1. Mettez à jour `CHANGELOG.md`.
2. Sur GitHub, créez une release avec un tag au format `vX.Y.Z` (par exemple `v0.2.0`), sans la marquer comme pre-release.
3. Le workflow met à jour `module.json` avec la version et les bonnes URLs, puis joint `module.json` et `module.zip` à la release. Foundry détecte la mise à jour automatiquement.

## Compatibilité

- Foundry VTT **v14**
- Indépendant du système de jeu (D&D, Cyberpunk RED, Warhammer 40K, homebrew…)

## Licence

[MIT](LICENSE) — © 2026 Argan
