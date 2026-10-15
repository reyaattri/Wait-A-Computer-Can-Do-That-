"""
Train a regenerating Neural Cellular Automaton (Mordvintsev et al., Distill 2020).

Every cell on a grid runs the *same* tiny neural network. It only sees its 3x3
neighbourhood, yet the colony learns to grow into a target shape from a single
seed cell -- and to regrow it after damage.

Usage:
    python train_nca.py --emoji 🦎 --name lizard --steps 4000

Writes ../weights/<name>.json, which the browser demo loads.
"""
import argparse
import json
import math
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageDraw, ImageFont

CHANNELS = 16
HIDDEN = 128
TARGET_SIZE = 40
PAD = 16
GRID = TARGET_SIZE + 2 * PAD
FIRE_RATE = 0.5
POOL_SIZE = 1024
BATCH = 8
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def render_emoji(ch: str, size: int = TARGET_SIZE) -> np.ndarray:
    """Rasterise a colour emoji with the Windows emoji font, return premultiplied RGBA."""
    font_path = r"C:\Windows\Fonts\seguiemj.ttf"
    big = 160
    img = Image.new("RGBA", (big * 2, big * 2), (0, 0, 0, 0))
    font = ImageFont.truetype(font_path, big)
    ImageDraw.Draw(img).text((big // 3, big // 3), ch, font=font, embedded_color=True)
    img = img.crop(img.getbbox())
    w, h = img.size
    s = size / max(w, h)
    img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.size[0]) // 2, (size - img.size[1]) // 2), img)
    a = np.asarray(canvas, dtype=np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]  # premultiply
    return a


class NCA(nn.Module):
    def __init__(self):
        super().__init__()
        ident = torch.tensor([[0, 0, 0], [0, 1, 0], [0, 0, 0]], dtype=torch.float32)
        sobel_x = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=torch.float32) / 8.0
        kernels = torch.stack([ident, sobel_x, sobel_x.T])  # 3 x 3 x 3
        kernels = kernels.repeat(CHANNELS, 1, 1)[:, None]  # (16*3) x 1 x 3 x 3
        self.register_buffer("kernels", kernels)
        self.w1 = nn.Conv2d(CHANNELS * 3, HIDDEN, 1)
        self.w2 = nn.Conv2d(HIDDEN, CHANNELS, 1, bias=False)
        nn.init.zeros_(self.w2.weight)

    def perceive(self, x):
        return F.conv2d(F.pad(x, (1, 1, 1, 1), mode="circular"), self.kernels, groups=CHANNELS)

    @staticmethod
    def alive(x):
        return F.max_pool2d(x[:, 3:4], 3, stride=1, padding=1) > 0.1

    def forward(self, x):
        pre = self.alive(x)
        dx = self.w2(F.relu(self.w1(self.perceive(x))))
        mask = (torch.rand_like(x[:, :1]) <= FIRE_RATE).float()
        x = x + dx * mask
        post = self.alive(x)
        return x * (pre & post).float()


def seed(n):
    x = torch.zeros(n, CHANNELS, GRID, GRID, device=DEV)
    x[:, 3:, GRID // 2, GRID // 2] = 1.0
    return x


def damage(x):
    """Cut a random circular hole into each sample."""
    n = x.shape[0]
    yy, xx = torch.meshgrid(torch.linspace(-1, 1, GRID, device=DEV), torch.linspace(-1, 1, GRID, device=DEV), indexing="ij")
    c = torch.rand(n, 2, device=DEV) * 1.0 - 0.5
    r = torch.rand(n, device=DEV) * 0.3 + 0.1
    m = ((xx[None] - c[:, 0, None, None]) ** 2 + (yy[None] - c[:, 1, None, None]) ** 2) < r[:, None, None] ** 2
    # Half of the wounds are big straight cuts (like the demo's "cut in half"), not just round holes.
    ang = torch.rand(n, device=DEV) * 2 * math.pi
    off = (torch.rand(n, device=DEV) - 0.5) * 0.3
    half = (xx[None] * torch.cos(ang)[:, None, None] + yy[None] * torch.sin(ang)[:, None, None]) > off[:, None, None]
    use_half = (torch.rand(n, device=DEV) < 0.5)[:, None, None]
    m = torch.where(use_half, half, m)
    return x * (~m)[:, None].float()


def load_weights(model, path):
    d = json.load(open(path))
    with torch.no_grad():
        model.w1.weight.copy_(torch.tensor(d["w1"]).view(HIDDEN, CHANNELS * 3, 1, 1))
        model.w1.bias.copy_(torch.tensor(d["b1"]))
        model.w2.weight.copy_(torch.tensor(d["w2"]).view(CHANNELS, HIDDEN, 1, 1))
    return d


@torch.no_grad()
def evaluate(model, target):
    """Worst-case quality over the three things the demo shows:
    growing from one cell, staying stable for a long time, and healing after being cut in half."""
    tmask = target[:, 3] > 0.1
    def stats(x):
        loss = ((x[:, :4] - target) ** 2).mean((1, 2, 3)).max().item()   # worst of the batch
        a = x[:, 3] > 0.1
        iou = ((a & tmask).sum((1, 2)).float() / (a | tmask).sum((1, 2)).float()).min().item()
        return loss, iou
    x = seed(4)
    for _ in range(200): x = model(x)
    grow = stats(x)
    for _ in range(1800): x = model(x)
    p2000 = stats(x)
    for _ in range(4000): x = model(x)       # long-haul: must still look right after 6000 steps
    p6000 = stats(x)
    persist = (max(p2000[0], p6000[0]), min(p2000[1], p6000[1]))
    x[:2, :, :, : GRID // 2] = 0          # cut two of them left/right
    x[2:, :, : GRID // 2, :] = 0          # and two of them top/bottom
    for _ in range(300): x = model(x)
    heal = stats(x)
    worst_loss = max(grow[0], persist[0], heal[0])
    worst_iou = min(grow[1], persist[1], heal[1])
    return worst_loss, worst_iou, (grow, persist, heal)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emoji", default="🦎")
    ap.add_argument("--name", default="lizard")
    ap.add_argument("--steps", type=int, default=4000)
    ap.add_argument("--resume", action="store_true", help="continue from weights/<name>.json")
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--threads", type=int, default=os.cpu_count())
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    torch.manual_seed(0)

    tgt = render_emoji(args.emoji)
    target = torch.from_numpy(np.pad(tgt, ((PAD, PAD), (PAD, PAD), (0, 0)))).permute(2, 0, 1)[None].to(DEV)
    print("device:", DEV, flush=True)

    out_dir = os.path.join(os.path.dirname(__file__), "..", "weights")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{args.name}.json")

    model = NCA().to(DEV)
    best = math.inf
    if args.resume and os.path.exists(path):
        load_weights(model, path)
        best, iou, parts = evaluate(model, target)
        print(f"resumed {path}: worst-case loss {best:.5f}  worst shape match {iou * 100:.1f}%", flush=True)

    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.MultiStepLR(opt, [int(args.steps * 0.5), int(args.steps * 0.8)], 0.3)
    # A pool of growing creatures in every stage of life. Training continues them across batches,
    # which is what teaches the rule to *keep* the shape rather than just reach it once.
    pool = seed(POOL_SIZE)
    with torch.no_grad():  # warm start: fill the pool with grown creatures from the current rule
        for i in range(0, POOL_SIZE, 64):
            x = pool[i:i + 64]
            for _ in range(int(torch.randint(64, 400, (1,)))): x = model(x)
            pool[i:i + 64] = x

    t0 = time.time()
    for step in range(1, args.steps + 1):
        idx = torch.randint(0, POOL_SIZE, (BATCH,), device=DEV)
        x = pool[idx].clone()
        with torch.no_grad():
            losses = ((x[:, :4] - target) ** 2).mean((1, 2, 3))
            order = torch.argsort(losses, descending=True)
            x, idx = x[order], idx[order]
            x[:1] = seed(1)  # worst sample goes back to a fresh seed
            x[-3:] = damage(x[-3:])  # best samples get wounded -> learn to heal

        for _ in range(int(torch.randint(64, 97, (1,)))):
            x = model(x)
        loss = ((x[:, :4] - target) ** 2).mean()

        opt.zero_grad()
        loss.backward()
        for p in model.parameters():  # per-variable gradient normalisation
            p.grad /= p.grad.norm() + 1e-8
        opt.step()
        sched.step()
        pool[idx] = x.detach()

        if step % 50 == 0 or step == 1:
            el = time.time() - t0
            print(f"step {step:5d}  loss {loss.item():.5f}  log10 {math.log10(loss.item()):.2f}  "
                  f"{el:6.0f}s  eta {el / step * (args.steps - step):6.0f}s", flush=True)
        if step % 250 == 0 or step == args.steps:
            score, iou, (g, pe, h) = evaluate(model, target)
            tag = "NEW BEST -> exported" if score < best else "kept previous best"
            print(f"  eval: grow {g[1] * 100:.1f}%  after 2000-6000 steps {pe[1] * 100:.1f}%  healed {h[1] * 100:.1f}%"
                  f"  | worst loss {score:.5f}  {tag}", flush=True)
            if score < best:
                best = score
                export(model, tgt, args, out_dir, step, score, iou)


def export(model, tgt, args, out_dir, step, loss, shape_match=None):
    w1 = model.w1.weight.detach()[:, :, 0, 0].cpu().numpy()  # HIDDEN x 48
    b1 = model.w1.bias.detach().cpu().numpy()
    w2 = model.w2.weight.detach()[:, :, 0, 0].cpu().numpy()  # 16 x HIDDEN
    r = lambda a: [round(float(v), 6) for v in a.ravel()]
    data = {
        "name": args.name, "emoji": args.emoji, "channels": CHANNELS, "hidden": HIDDEN,
        "grid": GRID, "fireRate": FIRE_RATE, "step": step, "loss": loss, "shapeMatch": shape_match,
        # perception layout per cell: [c0..c15 identity, c0..c15 sobel_x, c0..c15 sobel_y]
        # torch grouped conv interleaves (c0_id, c0_sx, c0_sy, c1_id, ...) -> keep that order
        "perceptionOrder": "interleaved",
        "w1": r(w1), "b1": r(b1), "w2": r(w2),
        "target": r(tgt),
    }
    path = os.path.join(out_dir, f"{args.name}.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)  # atomic: the browser never sees a half-written file
    print(f"  -> exported {path}", flush=True)


if __name__ == "__main__":
    main()
