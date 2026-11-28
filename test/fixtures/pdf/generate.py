"""Regenerate FileKit's original CC0 PDF fixtures with pypdf and Pillow."""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfWriter
from pypdf.annotations import Link
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject, TextStringObject

root = Path(__file__).parent


def text_pdf(labels):
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }))
    for index, label in enumerate(labels):
        page = writer.add_blank_page(width=300 + 50 * (index % 3), height=400 - 50 * (index % 3))
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 28 Tf 36 250 Td ({label}) Tj ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
    return writer


def write(writer, name):
    with (root / name).open("wb") as file:
        writer.write(file)


mixed = text_pdf(["First page", "Second page", "Third page", "Fourth page"])
mixed.pages[1].rotate(90)
mixed.add_metadata({"/Title": "Page samples", "/Author": "FileKit"})
mixed.add_outline_item("Third page bookmark", 2)
mixed.add_annotation(0, Link(rect=(36, 220, 175, 280), url="https://example.com/"))
mixed.add_annotation(0, Link(rect=(36, 180, 175, 210), target_page_index=2))
write(mixed, "mixed.pdf")

form = text_pdf(["Form page"])
widget = DictionaryObject({
    NameObject("/Type"): NameObject("/Annot"),
    NameObject("/Subtype"): NameObject("/Widget"),
    NameObject("/FT"): NameObject("/Tx"),
    NameObject("/T"): TextStringObject("Input"),
    NameObject("/V"): TextStringObject("Example"),
})
widget[NameObject("/Rect")] = ArrayObject([NumberObject(n) for n in (36, 180, 175, 210)])
form.add_annotation(0, widget)
form._root_object[NameObject("/AcroForm")] = form._add_object(DictionaryObject({
    NameObject("/Fields"): form.pages[0]["/Annots"],
}))
write(form, "form.pdf")

encrypted = text_pdf(["Password sample"])
encrypted.encrypt("filekit-test", algorithm="AES-256")
write(encrypted, "encrypted.pdf")
write(text_pdf([f"Page {i}" for i in range(1, 322)]), "large.pdf")

scan = Image.new("RGB", (480, 640), "white")
draw = ImageDraw.Draw(scan)
draw.rectangle((36, 36, 443, 603), outline="black", width=3)
draw.text((64, 64), "FileKit scanned page", fill="black")
for y in range(120, 520, 32):
    draw.line((64, y, 410 - y % 37, y), fill="#555555", width=3)
stream = BytesIO()
scan.save(stream, "PDF", title="Scanned page", creationDate=None, modDate=None)
(root / "scan.pdf").write_bytes(stream.getvalue())
