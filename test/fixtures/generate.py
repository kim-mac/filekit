"""Generate the synthetic FileKit test images with Pillow and pillow-heif."""
from pathlib import Path

from PIL import Image, ImageDraw
from pillow_heif import from_bytes, register_heif_opener

register_heif_opener()
root = Path(__file__).parent

chart = Image.new("RGB", (96, 64), (230, 65, 46))
draw = ImageDraw.Draw(chart)
draw.rectangle((48, 0, 95, 31), fill=(38, 170, 80))
draw.rectangle((0, 32, 47, 63), fill=(39, 107, 214))
draw.rectangle((48, 32, 95, 63), fill=(255, 214, 60))
chart.save(root / "reference.webp", quality=95)
chart.save(root / "reference.avif", quality=95, subsampling="4:4:4")
chart.save(root / "reference.heic", quality=95, chroma="444")

exif = Image.Exif()
exif[274] = 6
exif[270] = "filekit-private-fixture-marker"
chart.save(root / "oriented.jpg", quality=95, subsampling=0, exif=exif)
chart.save(root / "oriented.png", exif=exif)
chart.save(root / "oriented.webp", lossless=True, exif=exif)
chart.save(root / "oriented.heic", quality=95, chroma="444", exif=exif)
from_bytes(chart.mode, chart.size, chart.tobytes()).save(
    root / "container-oriented.heic", quality=95, chroma="444", exif=exif.tobytes()
)

odd = Image.new("RGB", (5, 3))
odd.putdata([(value, 32, 64) for value in range(1, 16)])
odd.save(root / "odd-oriented.png", exif=exif)

alpha = Image.new("RGBA", chart.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(alpha)
draw.rectangle((32, 8, 67, 55), fill=(65, 152, 241, 255))
draw.rectangle((72, 8, 90, 55), fill=(240, 50, 150, 120))
for y in range(9, 55):
    for x in range(33, 67):
        alpha.putpixel((x, y), ((x * 23 + y * 53) % 256, (x * 11) % 256, (y * 19) % 256, 255))
alpha.save(root / "transparent.png")

second = Image.new("RGB", chart.size, (255, 0, 255))
chart.save(root / "animated.gif", save_all=True, append_images=[second], duration=400, loop=0)
chart.save(root / "animated.webp", save_all=True, append_images=[second], duration=400, loop=0, lossless=True)

large = chart.resize((6000, 4000), Image.Resampling.BICUBIC)
large.save(root / "large-6000x4000.jpg", quality=90, exif=Image.Exif())
(root / "broken.jpg").write_bytes(b"\xff\xd8\xff\xe0\x00")
(root / "unsupported.txt").write_text("filekit-unsupported-private-fixture\n", encoding="utf-8")
