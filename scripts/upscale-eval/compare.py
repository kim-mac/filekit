"""Run the three ONNX models and render six comparison sheets with Pillow.

Pass the ONNX directory from export.py. Add --source-dir once to rebuild
the checked-in source images from rocket.jpg, astronaut.png and repository fixtures.
"""
import argparse
import json
from pathlib import Path
from time import perf_counter

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'docs/upscale-eval'
INPUTS = DEST / 'inputs'
CASES = {
    'person': ((54, 5, 95, 46), 'Photo of a person'),
    'landscape': ((62, 66, 103, 107), 'Cape Canaveral landscape'),
    'product': ((62, 52, 103, 93), 'Product photo'),
    'text': ((16, 23, 57, 64), 'Interface screenshot'),
    'archival-jpeg': ((28, 14, 69, 55), 'Archival photo, degraded JPEG'),
    'illustration': ((70, 23, 111, 64), 'Illustration'),
}


def make_inputs(source_dir):
    source = ROOT / 'test/fixtures/bg'
    for name, path, width in [
        ('person', source / 'person-urban.jpg', 156),
        ('landscape', source_dir / 'rocket.jpg', 164),
        ('product', source / 'vase-white.jpg', 164),
        ('archival-jpeg', source_dir / 'astronaut.png', 108),
    ]:
        with Image.open(path) as original:
            img = ImageOps.exif_transpose(original).convert('RGB')
            if name == 'person':
                img = img.crop((100, 45, min(img.width, 495), min(img.height, 455)))
            if name == 'archival-jpeg':
                img = img.crop((82, 6, 432, 356))
            img.thumbnail((width, width), Image.Resampling.LANCZOS)
            if name == 'archival-jpeg':
                img.save(INPUTS / (name + '.jpg'), quality=14)
            else:
                img.save(INPUTS / (name + '.png'))

    image = Image.new('RGB', (166, 110), '#e7edf7')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((7, 6, 159, 103), radius=6, fill='white', outline='#99a6b8')
    draw.rectangle((8, 17, 158, 19), fill='#3453de')
    draw.text((16, 24), 'Export image', font=ImageFont.load_default(13), fill='#162232')
    draw.text((16, 45), 'Width    126 px', font=ImageFont.load_default(10), fill='#334155')
    draw.text((16, 59), 'Height   102 px', font=ImageFont.load_default(10), fill='#334155')
    draw.rounded_rectangle((16, 76, 75, 94), radius=3, fill='#3453de')
    draw.text((23, 79), 'Download', font=ImageFont.load_default(10), fill='white')
    image.save(INPUTS / 'text.png')

    image = Image.new('RGB', (164, 110), '#24345a')
    draw = ImageDraw.Draw(image)
    draw.ellipse((96, 10, 130, 44), fill='#ffeaba')
    draw.polygon([(0, 83), (57, 25), (111, 83), (146, 61), (164, 77), (164, 110), (0, 110)], fill='#743d74')
    draw.polygon([(36, 46), (57, 25), (78, 47), (63, 42), (56, 49), (51, 43)], fill='#e9cad0')
    draw.polygon([(0, 90), (49, 78), (86, 94), (127, 77), (164, 88), (164, 110), (0, 110)], fill='#2c817a')
    for x, y in [(15, 12), (34, 28), (76, 11), (141, 23), (154, 10)]:
        draw.line((x - 3, y, x + 3, y), fill='#fff8df')
        draw.line((x, y - 3, x, y + 3), fill='#fff8df')
    image.save(INPUTS / 'illustration.png')


def compare(model_dir):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    models = [(name, ort.InferenceSession(str(model_dir / f'{file}.onnx'), options,
                                         providers=['CPUExecutionProvider'])) for name, file in [
        ('Real-ESRGAN x4plus', 'plus'), ('Real-ESRGAN general', 'general'), ('Real-ESRGAN animevideo', 'anime'),
    ]]
    timings = {}
    for case, (crop, title) in CASES.items():
        original = Image.open(next(INPUTS.glob(case + '.*'))).convert('RGB')
        bicubic = original.resize((original.width * 4, original.height * 4), Image.Resampling.BICUBIC)
        columns = [('Bicubic', bicubic)]
        source = np.asarray(original, dtype=np.float32).transpose(2, 0, 1)[None] / 255
        timings[case] = {'input_size': list(original.size)}
        for name, session in models:
            start = perf_counter()
            pixels = session.run(['output'], {'input': source})[0][0].transpose(1, 2, 0)
            timings[case][name] = round((perf_counter() - start) * 1000, 1)
            columns.append((name, Image.fromarray(np.rint(pixels.clip(0, 1) * 255).astype(np.uint8))))
        cell, gap = 276, 12
        sheet = Image.new('RGB', (4 * (cell + gap) + gap, 510), '#f0f3f7')
        draw = ImageDraw.Draw(sheet)
        draw.text((gap, 12), f'{title}  |  {original.width} x {original.height} input  |  4x output',
                  fill='#172334', font=ImageFont.load_default(22))
        draw.text((gap, 330), 'Boxed regions at native output resolution', fill='#172334', font=ImageFont.load_default(15))
        for index, (label, img) in enumerate(columns):
            x = gap + index * (cell + gap)
            draw.text((x, 54), label, fill='#172334', font=ImageFont.load_default(17))
            thumbnail = ImageOps.contain(img, (cell, 244), Image.Resampling.LANCZOS)
            left, top = x + (cell - thumbnail.width) // 2, 76 + (244 - thumbnail.height) // 2
            sheet.paste(thumbnail, (left, top))
            bx, by = thumbnail.width / original.width, thumbnail.height / original.height
            draw.rectangle((left + crop[0] * bx, top + crop[1] * by,
                            left + crop[2] * bx, top + crop[3] * by), outline='#00e2ff', width=2)
            # Keep the requested crop square and show it at native size in a consistent panel.
            zoom = img.crop(tuple(p * 4 for p in crop))
            sheet.paste(zoom, (x + (cell - zoom.width) // 2, 344))
        sheet.save(DEST / (case + '.webp'), lossless=True)
        print(case, timings[case], flush=True)
    (DEST / 'model-timings.json').write_text(json.dumps(timings, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', type=Path)
    parser.add_argument('--source-dir', type=Path)
    args = parser.parse_args()
    if args.source_dir:
        make_inputs(args.source_dir)
    compare(args.models)
