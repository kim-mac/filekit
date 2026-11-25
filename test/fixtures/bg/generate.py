"""Regenerate the four original synthetic fixtures and their alpha masks (Pillow)."""

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
SIZE = (512, 512)
SCALE = 3
HI = tuple(s * SCALE for s in SIZE)


def scaled(values):
    return tuple(round(v * SCALE) for v in values)


def ellipse(image, box, color):
    ImageDraw.Draw(image).ellipse(scaled(box), fill=color)


def rounded(image, box, radius, color):
    ImageDraw.Draw(image).rounded_rectangle(scaled(box), radius * SCALE, fill=color)


def line(image, points, color, width):
    ImageDraw.Draw(image).line([scaled(p) for p in points], fill=color, width=round(width * SCALE))


def finish(name, foreground, background):
    result = Image.alpha_composite(background, foreground).resize(SIZE, Image.Resampling.LANCZOS)
    result.convert("RGB").save(ROOT / f"{name}.jpg", quality=95, subsampling=0)
    foreground.getchannel("A").resize(SIZE, Image.Resampling.LANCZOS).save(ROOT / f"{name}-alpha.png")


def bottle(name, pale):
    body = Image.new("RGBA", HI)
    palette = (
        [(194, 186, 178), (222, 211, 196), (169, 162, 156), (207, 196, 183)]
        if pale else [(22, 91, 102), (79, 156, 164), (29, 54, 73), (42, 114, 126)]
    )
    rounded(body, (156, 145, 356, 426), 42, (*palette[0], 255))
    rounded(body, (182, 153, 232, 413), 24, (*palette[1], 255))
    rounded(body, (210, 92, 302, 158), 12, (*palette[0], 255))
    rounded(body, (200, 64, 312, 110), 13, (*palette[2], 255))
    for x in range(207, 308, 7):
        line(body, [(x, 76), (x, 98)], (*palette[3], 255), 2)
    rounded(body, (175, 235, 337, 329), 8, (*palette[3], 255))
    for offset, width in [(0, 86), (13, 57), (26, 72)]:
        rounded(body, (207, 264 + offset, 207 + width, 268 + offset), 2, (*palette[1], 255))
    bg = Image.new("RGBA", HI, (215, 207, 196, 255) if pale else (255, 255, 255, 255))
    shadow = Image.new("RGBA", HI)
    ellipse(shadow, (133, 417, 376, 442), (60, 45, 33, 65))
    finish(name, body, Image.alpha_composite(bg, shadow.filter(ImageFilter.GaussianBlur(11 * SCALE))))


def glass():
    fg = Image.new("RGBA", HI)
    rounded(fg, (163, 117, 349, 352), 74, (200, 225, 230, 65))
    ellipse(fg, (163, 92, 349, 145), (235, 247, 252, 215))
    ellipse(fg, (173, 99, 339, 137), (173, 202, 202, 72))
    ellipse(fg, (188, 314, 324, 360), (167, 199, 212, 112))
    rounded(fg, (251, 342, 261, 419), 4, (215, 241, 242, 194))
    ellipse(fg, (189, 409, 323, 437), (210, 234, 242, 188))
    line(fg, [(176, 146), (178, 199), (184, 250), (196, 290), (217, 318)], (247, 255, 250, 195), 5)
    line(fg, [(337, 147), (334, 215), (321, 272), (304, 304)], (230, 245, 242, 163), 4)
    bg = Image.new("RGBA", HI, (54, 83, 92, 255))
    for x in range(4, 512, 37):
        line(bg, [(x, 0), (x, 511)], (100, 123, 124, 255), 10)
    line(bg, [(0, 419), (511, 419)], (99, 72, 59, 255), 185)
    finish("glass-stemware", fg, bg.filter(ImageFilter.GaussianBlur(2 * SCALE)))


def fur():
    rng = random.Random(481)
    foreground = Image.new("RGBA", HI)
    background = Image.new("RGBA", HI, (83, 109, 89, 255))
    for _ in range(100):
        x, y = rng.randrange(512), rng.randrange(512)
        r = rng.randrange(8, 48)
        color = (rng.randrange(45, 131), rng.randrange(61, 163), rng.randrange(43, 109), 255)
        ellipse(background, (x - r, y - r, x + r, y + r), color)
    background = background.filter(ImageFilter.GaussianBlur(8 * SCALE))
    ellipse(foreground, (110, 145, 402, 443), (152, 78, 45, 255))
    for _ in range(3000):
        angle = rng.uniform(0, 2 * math.pi)
        distance = rng.uniform(0.2, 1.01)
        x = 256 + 145 * math.cos(angle) * distance
        y = 294 + 148 * math.sin(angle) * distance
        length = rng.uniform(4, 37)
        end = (x + length * math.cos(angle), y + length * math.sin(angle))
        shade = rng.randrange(97, 232)
        line(foreground, [(x, y), end], (shade, round(shade * 0.62), round(shade * 0.41), rng.randrange(140, 256)),
             rng.uniform(0.55, 2.2))
    for x in (168, 344):
        ellipse(foreground, (x - 45, 110, x + 45, 213), (151, 79, 54, 255))
        ellipse(foreground, (x - 28, 130, x + 28, 201), (188, 124, 95, 255))
    for x in (212, 300):
        ellipse(foreground, (x - 13, 256, x + 13, 282), (35, 22, 21, 255))
        ellipse(foreground, (x - 5, 260, x, 265), (244, 231, 204, 255))
    ellipse(foreground, (220, 296, 292, 354), (201, 129, 81, 255))
    ellipse(foreground, (239, 297, 273, 322), (56, 32, 26, 255))
    finish("fuzzy-toy", foreground, background)


if __name__ == "__main__":
    bottle("product-white", False)
    bottle("product-low-contrast", True)
    glass()
    fur()
