"""Render slide images for Session 01 from the real trained model.

    python make_slide_images.py          -> writes ../../slides/session-01/*.png
"""
import json, math, os, re
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

import train_nca as T

T.DEV = torch.device("cpu")
torch.manual_seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "slides", "session-01")
os.makedirs(OUT, exist_ok=True)

INK, CREAM, VIOLET, PINK, AMBER, MINT = "#1E293B", "#FFFDF5", "#8B5CF6", "#F472B6", "#FBBF24", "#34D399"
F = lambda name, size: ImageFont.truetype(rf"C:\Windows\Fonts\{name}", size)
TITLE, BOLD, BODY, MONO = F("seguibl.ttf", 54), F("segoeuib.ttf", 34), F("segoeui.ttf", 28), F("consola.ttf", 26)

d = json.load(open(os.path.join(HERE, "..", "weights", "lizard.json")))
model = T.NCA()
T.load_weights(model, os.path.join(HERE, "..", "weights", "lizard.json"))
model.eval()
G = T.GRID


def canvas(w=1600, h=900, title=None):
    im = Image.new("RGB", (w, h), CREAM)
    dr = ImageDraw.Draw(im)
    for x in range(0, w, 28):
        for y in range(0, h, 28):
            dr.ellipse((x - 1.5, y - 1.5, x + 1.5, y + 1.5), fill="#E7E4DA")
    if title:
        dr.text((70, 50), title, font=TITLE, fill=INK)
    return im, dr


def to_img(x, size, crop=12):
    """Premultiplied RGBA state -> picture on white, cropped to the middle of the grid."""
    s = x[0, :4].clamp(0, 1).permute(1, 2, 0).numpy()
    rgb = (1 - s[..., 3:4]) + np.minimum(s[..., :3], s[..., 3:4])
    a = (rgb * 255).astype(np.uint8)[crop:G - crop, crop:G - crop]
    return Image.fromarray(a).resize((size, size), Image.NEAREST)


def sticker(im, dr, pic, x, y, label=None, shadow=INK):
    w, h = pic.size
    dr.rounded_rectangle((x + 8, y + 8, x + w + 8, y + h + 8), 22, fill=shadow)
    dr.rounded_rectangle((x - 3, y - 3, x + w + 3, y + h + 3), 22, fill="white", outline=INK, width=4)
    mask = Image.new("L", pic.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), 20, fill=255)
    im.paste(pic, (x, y), mask)
    if label:
        dr.text((x + w // 2, y + h + 40), label, font=BOLD, fill=INK, anchor="mm")


@torch.no_grad()
def run(x, n):
    for _ in range(n):
        x = model(x)
    return x


# 1. Growing from a single cell ---------------------------------------------------------------
im, dr = canvas(title="From one cell to a lizard")
x = T.seed(1)
shots, done = [0, 15, 30, 50, 100, 250], 0
for i, step in enumerate(shots):
    x = run(x, step - done); done = step
    sticker(im, dr, to_img(x, 210), 70 + i * 250, 340, "1 cell" if step == 0 else f"step {step}")
dr.text((70, 140), "Every pixel follows the same tiny rule. Nobody draws the lizard.", font=BODY, fill="#475569")
im.save(os.path.join(OUT, "01_growth.png"))
grown = x.clone()

# 2. Cut in half, then heal ------------------------------------------------------------------
im, dr = canvas(title="Cut it in half… it grows back")
x = grown.clone()
frames = [("grown", x.clone())]
x[:, :, :, : G // 2] = 0
frames.append(("cut!", x.clone()))
done = 0
for step in [20, 50, 100, 250]:
    x = run(x, step - done); done = step
    frames.append((f"+{step} steps", x.clone()))
for i, (lab, f) in enumerate(frames):
    sticker(im, dr, to_img(f, 210), 70 + i * 250, 340, lab, shadow=PINK if lab == "cut!" else INK)
dr.text((70, 140), "No undo button. The surviving cells rebuild what's missing.", font=BODY, fill="#475569")
im.save(os.path.join(OUT, "02_heal.png"))

# 3. Target vs. what it grew --------------------------------------------------------------------
im, dr = canvas(title="What we asked for vs. what it grew")
tgt = np.array(d["target"], dtype=np.float32).reshape(T.TARGET_SIZE, T.TARGET_SIZE, 4)
t_rgb = ((1 - tgt[..., 3:4]) + tgt[..., :3]).clip(0, 1)
t_img = Image.fromarray((t_rgb * 255).astype(np.uint8)).resize((480, 480), Image.NEAREST)
g = run(grown.clone(), 300)
pad = T.PAD
g_img = Image.fromarray(((((1 - g[0, 3:4].clamp(0, 1)) + torch.minimum(g[0, :3].clamp(0, 1), g[0, 3:4].clamp(0, 1))).clamp(0, 1).permute(1, 2, 0).numpy()[pad:pad + 40, pad:pad + 40]) * 255).astype(np.uint8)).resize((480, 480), Image.NEAREST)
sticker(im, dr, t_img, 230, 220, "target emoji (40 × 40 pixels)")
sticker(im, dr, g_img, 890, 220, "grown by the cells", shadow=MINT)
dr.text((800, 460), "≈", font=TITLE, fill=INK, anchor="mm")
im.save(os.path.join(OUT, "03_target_vs_grown.png"))

# 4. A cell only sees its 8 neighbours ------------------------------------------------------------
im, dr = canvas(title="Each cell only sees its 8 neighbours")
z = grown[0, :4].clamp(0, 1).permute(1, 2, 0).numpy()
cy, cx = G // 2, G // 2 - 2
patch = z[cy - 4:cy + 5, cx - 4:cx + 5]
cell = 72
ox, oy = 140, 200
for r in range(9):
    for c in range(9):
        rgb = ((1 - patch[r, c, 3]) + np.minimum(patch[r, c, :3], patch[r, c, 3])).clip(0, 1)
        col = tuple(int(v * 255) for v in rgb)
        dr.rectangle((ox + c * cell, oy + r * cell, ox + (c + 1) * cell - 3, oy + (r + 1) * cell - 3), fill=col)
dr.rectangle((ox + 3 * cell - 6, oy + 3 * cell - 6, ox + 6 * cell + 3, oy + 6 * cell + 3), outline=PINK, width=8)
dr.rectangle((ox + 4 * cell, oy + 4 * cell, ox + 5 * cell - 3, oy + 5 * cell - 3), outline=INK, width=6)
bx = 900
for i, (h, b) in enumerate([
    ("It can't see the whole lizard", "Only the 3 × 3 square around it."),
    ("It can't talk to far-away cells", "Information spreads one step at a time."),
    ("Yet together they make a shape", "Like cells in an embryo."),
]):
    y = 230 + i * 170
    dr.ellipse((bx, y, bx + 54, y + 54), fill=[PINK, AMBER, MINT][i], outline=INK, width=4)
    dr.text((bx + 27, y + 27), str(i + 1), font=BOLD, fill=INK, anchor="mm")
    dr.text((bx + 80, y - 2), h, font=BOLD, fill=INK)
    dr.text((bx + 80, y + 46), b, font=BODY, fill="#475569")
im.save(os.path.join(OUT, "04_neighbourhood.png"))

# 5. 16 numbers per cell ---------------------------------------------------------------------------
im, dr = canvas(title="Every cell carries 16 numbers")
labels = ["R", "G", "B", "alive"] + [f"h{i}" for i in range(1, 13)]
v = grown[0, :, G // 2, G // 2 - 3].numpy()
x0, y0, wbox = 90, 330, 86
for i in range(16):
    fill = ["#FCA5A5", "#86EFAC", "#93C5FD", AMBER][i] if i < 4 else "#E9D5FF"
    dr.rounded_rectangle((x0 + i * wbox, y0, x0 + i * wbox + wbox - 10, y0 + 130), 14, fill=fill, outline=INK, width=4)
    dr.text((x0 + i * wbox + (wbox - 10) / 2, y0 + 38), labels[i], font=BOLD if len(labels[i]) < 4 else F("segoeuib.ttf", 22), fill=INK, anchor="mm")
    dr.text((x0 + i * wbox + (wbox - 10) / 2, y0 + 92), f"{v[i]:.2f}", font=F("consola.ttf", 22), fill=INK, anchor="mm")
dr.text((x0 + 2 * wbox - 5, y0 + 190), "4 you can see", font=BOLD, fill=INK, anchor="mm")
dr.text((x0 + 10 * wbox - 5, y0 + 190), "12 hidden “chemical signals” it invented itself", font=BOLD, fill=VIOLET, anchor="mm")
dr.text((90, 140), "Real values from one cell of the trained lizard.", font=BODY, fill="#475569")
im.save(os.path.join(OUT, "05_sixteen_numbers.png"))

# 6. Hidden channels -------------------------------------------------------------------------------
im, dr = canvas(title="The hidden channels: chemistry nobody designed")
hs = grown[0, 4:].numpy()
for k in range(12):
    ch = np.clip(hs[k], -1, 1)[12:G - 12, 12:G - 12]
    rgb = np.ones(ch.shape + (3,))
    pos, neg = np.clip(ch, 0, 1)[..., None], np.clip(-ch, 0, 1)[..., None]
    rgb = rgb * (1 - pos) + np.array([52, 211, 153]) / 255 * pos
    rgb = rgb * (1 - neg) + np.array([244, 114, 182]) / 255 * neg
    pic = Image.fromarray((rgb * 255).astype(np.uint8)).resize((200, 200), Image.NEAREST)
    r, c = divmod(k, 6)
    sticker(im, dr, pic, 90 + c * 245, 200 + r * 300, f"channel {k + 5}")
dr.text((1530, 140), "green = positive · pink = negative", font=BODY, fill="#475569", anchor="ra")
im.save(os.path.join(OUT, "06_hidden_channels.png"))

# 7. The rule, as a diagram -----------------------------------------------------------------------
im, dr = canvas(title="One update step")
boxes = [
    ("Look", "its 3 × 3 square:\neach of 16 numbers,\nplus how it changes\n← → and ↑ ↓", "48 numbers", AMBER),
    ("Think", "tiny neural network\n48 → 128 → 16\n(~8,300 weights)", "16 changes", VIOLET),
    ("Act", "add the changes\nbut only 50% of cells\nupdate each step", "random, like biology", PINK),
    ("Live or die", "a cell with no living\nneighbour is set\nback to empty", "keeps it tidy", MINT),
]
for i, (h, b, out, col) in enumerate(boxes):
    x = 70 + i * 380
    dr.rounded_rectangle((x + 8, 230 + 8, x + 320 + 8, 640 + 8), 26, fill=INK)
    dr.rounded_rectangle((x, 230, x + 320, 640), 26, fill="white", outline=INK, width=4)
    dr.rounded_rectangle((x, 230, x + 320, 320), 26, fill=col, outline=INK, width=4)
    dr.rectangle((x + 4, 290, x + 316, 318), fill=col)
    dr.text((x + 160, 275), h, font=BOLD, fill="white" if col == VIOLET else INK, anchor="mm")
    dr.multiline_text((x + 160, 450), b, font=BODY, fill=INK, anchor="mm", align="center", spacing=10)
    dr.text((x + 160, 600), out, font=F("segoeuib.ttf", 24), fill="#475569", anchor="mm")
    if i < 3:
        dr.polygon([(x + 335, 420), (x + 365, 435), (x + 335, 450)], fill=INK)
dr.text((800, 760), "Repeat for every cell, ~60 times a second.", font=BOLD, fill=INK, anchor="mm")
im.save(os.path.join(OUT, "07_one_step.png"))

# 8. Training curve -----------------------------------------------------------------------------------
im, dr = canvas(title="Training: 5,000 practice rounds on my GPU")
pts = []
for f, off in [("train_lizard.log", 0), ("retrain_lizard.log", 2000)]:
    p = os.path.join(HERE, f)
    if not os.path.exists(p):
        continue
    for line in open(p, encoding="utf8"):
        m = re.match(r"step\s+(\d+)\s+loss\s+([\d.]+)", line)
        if m:
            pts.append((int(m.group(1)) + off, float(m.group(2))))
if pts:
    L, R, Tp, B = 170, 1500, 200, 760
    xs = [p[0] for p in pts]; ys = [math.log10(p[1]) for p in pts]
    xmax, ymin, ymax = max(xs), math.floor(min(ys)), math.ceil(max(ys))
    X = lambda s: L + (R - L) * s / xmax
    Y = lambda v: B - (B - Tp) * (v - ymin) / (ymax - ymin)
    for e in range(ymin, ymax + 1):
        dr.line((L, Y(e), R, Y(e)), fill="#E2E8F0", width=2)
        dr.text((L - 20, Y(e)), f"10^{e}", font=MONO, fill="#64748B", anchor="rm")
    dr.line((X(2000), Tp, X(2000), B), fill=PINK, width=3)
    dr.text((X(2000) + 12, Tp + 4), "round 2: stress-tested for stability", font=F("segoeuib.ttf", 24), fill=PINK)
    dr.line([(X(a), Y(b)) for a, b in zip(xs, ys)], fill=VIOLET, width=5, joint="curve")
    dr.line((L, B, R, B), fill=INK, width=3)
    for t in range(0, xmax + 1, 1000):
        dr.line((X(t), B, X(t), B + 10), fill=INK, width=3)
        dr.text((X(t), B + 28), f"{t:,}", font=MONO, fill="#64748B", anchor="mm")
    dr.text(((L + R) / 2, B + 72), "training step", font=BODY, fill="#475569", anchor="mm")
    dr.text((L, Tp - 40), "error (lower is better)", font=BODY, fill="#475569")
im.save(os.path.join(OUT, "08_training_curve.png"))

# 9. Before / after stability ---------------------------------------------------------------------
im, dr = canvas(title="Getting it to stay healthy")
rows = [("Lizard", 86, 98.7), ("Butterfly", 49, 97.0)]
for i, (name, before, after) in enumerate(rows):
    y = 260 + i * 260
    dr.text((90, y + 40), name, font=BOLD, fill=INK, anchor="lm")
    for j, (val, col, lab) in enumerate([(before, "#CBD5E1", "first try"), (after, MINT, "after fixing")]):
        yy = y + j * 90
        w = 1050 * val / 100
        dr.rounded_rectangle((330, yy, 330 + 1050, yy + 64), 32, fill="white", outline=INK, width=3)
        dr.rounded_rectangle((330, yy, 330 + w, yy + 64), 32, fill=col, outline=INK, width=3)
        dr.text((356, yy + 32), f"{val:g}%  {lab}", font=F("segoeuib.ttf", 26), fill=INK, anchor="lm")
dr.text((90, 160), "How well it still matches the target after thousands of steps (measured with the browser code).", font=BODY, fill="#475569")
im.save(os.path.join(OUT, "09_before_after.png"))

print("wrote", sorted(os.listdir(OUT)))
