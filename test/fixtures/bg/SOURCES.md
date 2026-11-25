# Background removal benchmark fixtures

Fixture IDs match [fixtures.json](fixtures.json). Photos were rotated using EXIF orientation, resized to a maximum 640 px on the long side, and re-encoded without embedded metadata. The comparison sheets carry the same image terms. Photographs have no reference masks.

| Fixture | Creator and original | Redistribution license | Retrieved from |
| --- | --- | --- | --- |
| portrait-wind | [Michael Dam on Unsplash](https://unsplash.com/@michaeldam) | [Unsplash License](https://unsplash.com/license) | [Attributed MODNet sample](https://github.com/voodoohop/modnet/blob/eff345bdec5a35d3277677b4f71f57b693bc0b9b/assets/sample_image/female.jpeg) |
| portrait-dark-hair | [Erik Lucatero on Unsplash](https://unsplash.com/@erik_lucatero) | [Unsplash License](https://unsplash.com/license) | [Attributed MODNet sample](https://github.com/voodoohop/modnet/blob/eff345bdec5a35d3277677b4f71f57b693bc0b9b/assets/sample_image/male.jpeg) |
| person-urban | [Didi Medina, Woman posing by drainpipe](https://commons.wikimedia.org/wiki/File:Woman_posing_by_drainpipe_(Unsplash).jpg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Posegraph sample](https://github.com/extrant/Posegraph/blob/9323076146db5d8221d01ef9911b85e14deb2051/docs/tutorial/images/sample-arms-open.jpg) |
| tabby-clutter | [Alvan Nee](https://unsplash.com/photos/LaXCd-05C6A) | [Unsplash License](https://unsplash.com/license) | [DreamBooth cat/00](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/cat/00.jpg) |
| gray-cat | [Milada Vigerova](https://unsplash.com/photos/JLN0U5Rj0gg) | [Unsplash License](https://unsplash.com/license) | [DreamBooth cat2/02](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/cat2/02.jpg) |
| chow-fur | [Łukasz Rawa](https://unsplash.com/photos/6gNjFIQiVMA) | [Unsplash License](https://unsplash.com/license) | [DreamBooth dog2/01](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/dog2/01.jpg) |
| dog-trail | [Anna Dudkova](https://unsplash.com/photos/DORi0W_afqk) | [Unsplash License](https://unsplash.com/license) | [DreamBooth dog8/01](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/dog8/01.jpg) |
| vase-white | [Oriento](https://unsplash.com/photos/lh7ZFoTtfi0) | [Unsplash License](https://unsplash.com/license) | [DreamBooth vase/02](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/vase/02.jpg) |
| teapot-clutter | [Oriento](https://unsplash.com/photos/VloyvGLX_kU) | [Unsplash License](https://unsplash.com/license) | [DreamBooth teapot/00](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/teapot/00.jpg) |
| tinted-lenses | [Laura Chouette](https://unsplash.com/photos/VgVvWHYwl3c) | [Unsplash License](https://unsplash.com/license) | [DreamBooth pink_sunglasses/01](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/pink_sunglasses/01.jpg) |
| backpack | [Laura Chouette](https://unsplash.com/photos/KGq78h_aO2E) | [Unsplash License](https://unsplash.com/license) | [DreamBooth backpack/02](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/backpack/02.jpg) |
| product-white | Original bottle on white and grayscale alpha | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [generate.py](generate.py) |
| product-low-contrast | Original bottle on similar tones and grayscale alpha | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [generate.py](generate.py) |
| glass-stemware | Original transparent illustration and grayscale alpha | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [generate.py](generate.py) |
| fuzzy-toy | Original toy with thin strands and grayscale alpha | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [generate.py](generate.py) |

The synthetic images and their masks are dedicated under CC0 1.0. The generator derives each mask from the foreground's alpha before compositing and resampling. The background includes the bottle shadows. The glass fixture simulates partial opacity and omits physical refraction. No outside assets are used in the generator.

The face detector golden and browser tests use the CC0 `person-urban.jpg` portrait by Didi Medina.

The photo mirrors document the original licenses. [MODNet photo credits](https://github.com/voodoohop/modnet/blob/eff345bdec5a35d3277677b4f71f57b693bc0b9b/README.md), [Posegraph photo credits](https://github.com/extrant/Posegraph/blob/9323076146db5d8221d01ef9911b85e14deb2051/docs/tutorial/README.md#sample-image-credits), [DreamBooth references and licenses](https://github.com/google/dreambooth/blob/4f887af7970a06fc0cd3adaa1d0b368547d6a1d0/dataset/references_and_licenses.txt).
