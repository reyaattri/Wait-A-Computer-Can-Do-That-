"""Transparent cut-outs of the trained lizard for the Gamma "Metamorphosis" template.

    python make_gamma_assets.py   -> ../../slides/session-01/gamma/*.png
"""
import os
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter

import train_nca as T

T.DEV = torch.device("cpu")
torch.manual_seed(11)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "slides", "session-01", "gamma")
os.makedirs(OUT, exist_ok=True)
G = T.GRID
WARM, INK = (246, 240, 226), (17, 17, 17)

model = T.NCA()
T.load_weights(model, os.path.join(HERE, "..", "weights", "lizard.json"))


@torch.no_grad()
def run(x, n):
    for _ in range(n):
        x = model(x)
    return x


def cutout(x, scale=14, box=None):
    """True colours, transparent where the creature isn't."""
    s = x[0, :4].clamp(0, 1).permute(1, 2, 0).numpy()
    a = s[..., 3]
    rgb = np.where(a[..., None] > 1e-3, np.minimum(s[..., :3], a[..., None]) / np.maximum(a[..., None], 1e-3), 0)
    rgba = np.dstack([rgb, a])
    im = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
    im = im.crop(box or (10, 10, G - 10, G - 10))
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def stencil(x, scale=16):
    """Warm-white silhouette with black markings taken from two real hidden channels."""
    a = x[0, 3].clamp(0, 1).numpy()
    h = x[0, 4:].numpy()
    marks = (h[0] > 0.5) | (h[2] < -0.5)           # channels 5 and 7: the cells' own spotty "chemistry"
    big = lambda m: np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((G * scale, G * scale), Image.BICUBIC)) / 255
    alpha, mk = big(a), big(marks.astype(float))
    rng = np.random.default_rng(3)
    wear = rng.random(alpha.shape) < 0.07                         # worn print: specks of missing ink
    alpha = np.where((alpha > 0.45) & ~wear, 1.0, 0.0)
    col = np.where((mk > 0.5)[..., None], INK, WARM)
    rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA").crop((10 * scale, 10 * scale, (G - 10) * scale, (G - 10) * scale))
    return im.filter(ImageFilter.MedianFilter(3))


def channel_ink(x, k, scale=12):
    """One hidden channel printed in black ink, strength = |value|."""
    v = np.clip(np.abs(x[0, 4 + k].numpy()), 0, 1)
    rgba = np.zeros((G, G, 4), np.uint8); rgba[..., :3] = INK; rgba[..., 3] = (v * 255).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA").crop((10, 10, G - 10, G - 10))
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


# growth stages
x = T.seed(1); done = 0
for i, step in enumerate([15, 30, 60, 120, 300]):
    x = run(x, step - done); done = step
    cutout(x).save(os.path.join(OUT, f"grow_{i + 1}_step{step}.png"))
grown = run(x, 200)
cutout(grown).save(os.path.join(OUT, "lizard_grown.png"))
stencil(grown).save(os.path.join(OUT, "lizard_stencil.png"))

# heal sequence
y = grown.clone(); y[:, :, :, : G // 2] = 0
cutout(y).save(os.path.join(OUT, "heal_1_cut.png"))
done = 0
for i, step in enumerate([30, 80, 250]):
    y = run(y, step - done); done = step
    cutout(y).save(os.path.join(OUT, f"heal_{i + 2}_plus{step}.png"))

# target emoji, same framing
tgt = np.array(__import__("json").load(open(os.path.join(HERE, "..", "weights", "lizard.json")))["target"], np.float32).reshape(40, 40, 4)
a = tgt[..., 3:4]; rgb = np.where(a > 1e-3, tgt[..., :3] / np.maximum(a, 1e-3), 0)
Image.fromarray((np.dstack([rgb, a]) * 255).astype(np.uint8), "RGBA").resize((40 * 14, 40 * 14), Image.NEAREST).save(os.path.join(OUT, "target_emoji.png"))

# hidden channels in ink
for k in range(12):
    channel_ink(grown, k).save(os.path.join(OUT, f"channel_{k + 5:02d}.png"))

# 3x3 neighbourhood diagram in the template's palette
cell, n = 90, 5
im = Image.new("RGBA", (cell * n + 8, cell * n + 8), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
for r in range(n):
    for c in range(n):
        inside = 1 <= r <= 3 and 1 <= c <= 3
        d.rectangle((4 + c * cell, 4 + r * cell, 4 + (c + 1) * cell - 6, 4 + (r + 1) * cell - 6),
                    fill=WARM + (255 if inside else 90,), outline=INK + (255,), width=3 if inside else 1)
d.rectangle((4 + 2 * cell, 4 + 2 * cell, 4 + 3 * cell - 6, 4 + 3 * cell - 6), fill=INK + (255,))
im.save(os.path.join(OUT, "neighbourhood_3x3.png"))

print("wrote", len(os.listdir(OUT)), "files to", os.path.abspath(OUT))
