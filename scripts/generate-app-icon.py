#!/usr/bin/env python3
"""Render the Pi App SVG source into the PNG and ICNS bundle assets used by Tauri."""

from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

ICON_DIRECTORY = Path(__file__).parents[1] / "desktop" / "src-tauri" / "icons"
CANVAS_SIZE = 1024
BACKGROUND = "#f7f5f1"
CORAL = "#e98c78"
BLUE = "#5a9abf"
GOLD = "#ecc261"


def _scale(value: int, size: int) -> int:
    return round(value * size / CANVAS_SIZE)


def draw_pi_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    drawing = ImageDraw.Draw(image)
    drawing.rounded_rectangle(
        tuple(_scale(value, size) for value in (48, 48, 976, 976)),
        radius=_scale(208, size),
        fill=BACKGROUND,
    )
    drawing.rectangle(
        tuple(_scale(value, size) for value in (220, 240, 804, 348)), fill=CORAL
    )
    drawing.rectangle(
        tuple(_scale(value, size) for value in (280, 348, 406, 788)), fill=BLUE
    )
    drawing.rectangle(
        tuple(_scale(value, size) for value in (618, 348, 744, 788)), fill=GOLD
    )
    return image


def write_icns() -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
        iconset = Path(temporary_directory) / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                rendered_size = size * scale
                draw_pi_icon(rendered_size).save(
                    iconset / f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                )
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ICON_DIRECTORY / "icon.icns")],
            check=True,
        )


def main() -> None:
    if shutil.which("iconutil") is None:
        raise RuntimeError("iconutil is required to generate the macOS ICNS bundle asset")
    draw_pi_icon(CANVAS_SIZE).save(ICON_DIRECTORY / "icon.png")
    write_icns()


if __name__ == "__main__":
    main()
