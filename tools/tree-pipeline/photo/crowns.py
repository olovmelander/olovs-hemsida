"""Round 4: the learned crown detector on the June 2025 photo (DeepForest).

DeepForest (weecology, MIT licence) is a RetinaNet (ResNet-50 FPN) trained on
10 cm RGB airborne imagery; its torchvision transform resizes every input to
800 px on the short side, so the scale a crown reaches the network at is set
by the patch's ground size: a 40 m patch gives the 20 px/m of its training
(400 px at 0.1 m, resized to 800). The photo is read at its native 0.16 m and
the patch size is given in metres.

Photo pixels, crops and weights stay in the ignored cache. Coordinates in and
out are EPSG:3006 in PHOTO space (where the orthophoto draws each crown); the
fusion (photo-fusion.mjs) moves every crown back to its trunk with the
relief field.

  python -I crowns.py detect --raster <ortho.json> --out <crowns.json>
         [--regions <json: [{id, bbox}]>] [--weights <pt>] [--patch-metres 40]
         [--overlap 0.25] [--score 0.05] [--nms 0.2] [--device cuda]
  python -I crowns.py train  --raster <ortho.json> --train <train.json> --out <pt>
         [--windows id,id] [--epochs 8] [--lr 1e-4] [--patch-metres 40] [--seed 7]
  python -I crowns.py info   (versions, device, weights sha256)
"""
import argparse
import hashlib
import json
import os
import random
import sys
import time

import numpy as np
import torch
import torchvision

MODEL_NAME = "weecology/deepforest-tree"
MODEL_REVISION = "main"


def load_raster(meta_path):
    meta = json.load(open(meta_path))
    data = np.memmap(os.path.join(os.path.dirname(meta_path), os.path.basename(meta_path)[:-5] + ".rgb"), dtype=np.uint8, mode="r", shape=(meta["height"], meta["width"], 3))
    return meta, data


def window_pixels(meta, bbox):
    p = meta["pixelMetres"]
    c0 = int(np.floor((bbox[0] - meta["minEasting"]) / p))
    c1 = int(np.ceil((bbox[2] - meta["minEasting"]) / p))
    r0 = int(np.floor((meta["maxNorthing"] - bbox[3]) / p))
    r1 = int(np.ceil((meta["maxNorthing"] - bbox[1]) / p))
    return max(0, c0), max(0, r0), min(meta["width"], c1), min(meta["height"], r1)


def build_model(weights=None, device="cuda", score=0.05, nms=0.2):
    from deepforest import main as dfmain
    m = dfmain.deepforest(config_args={"score_thresh": score, "nms_thresh": nms})
    net = m.model
    if weights:
        state = torch.load(weights, map_location="cpu", weights_only=True)
        net.load_state_dict(state)
    net.score_thresh = score
    net.nms_thresh = nms
    net.detections_per_img = 300
    return net.to(device), m


def tiles_for(width, height, patch, stride):
    xs = list(range(0, max(1, width - patch) + 1, stride))
    ys = list(range(0, max(1, height - patch) + 1, stride))
    if xs[-1] + patch < width:
        xs.append(max(0, width - patch))
    if ys[-1] + patch < height:
        ys.append(max(0, height - patch))
    return [(x, y) for y in ys for x in xs]


@torch.no_grad()
def detect_region(net, meta, data, bbox, patch_metres, overlap, device, batch=16):
    p = meta["pixelMetres"]
    c0, r0, c1, r1 = window_pixels(meta, bbox)
    region = np.asarray(data[r0:r1, c0:c1, :])
    h, w = region.shape[:2]
    patch = int(round(patch_metres / p))
    stride = max(1, int(round(patch * (1 - overlap))))
    boxes, scores = [], []
    tl = tiles_for(w, h, patch, stride)
    net.eval()
    for i in range(0, len(tl), batch):
        chunk = tl[i:i + batch]
        imgs = []
        for (x, y) in chunk:
            t = np.zeros((patch, patch, 3), dtype=np.uint8)
            part = region[y:y + patch, x:x + patch]
            t[:part.shape[0], :part.shape[1]] = part
            imgs.append(torch.from_numpy(t).permute(2, 0, 1).float().div(255).to(device))
        out = net(imgs)
        for (x, y), o in zip(chunk, out):
            b = o["boxes"].cpu().numpy()
            s = o["scores"].cpu().numpy()
            if not len(b):
                continue
            # drop boxes cut by an inner tile edge (the neighbouring tile sees them whole)
            keep = np.ones(len(b), dtype=bool)
            margin = 2
            if x > 0:
                keep &= b[:, 0] > margin
            if y > 0:
                keep &= b[:, 1] > margin
            if x + patch < w:
                keep &= b[:, 2] < patch - margin
            if y + patch < h:
                keep &= b[:, 3] < patch - margin
            b = b[keep]
            s = s[keep]
            b[:, [0, 2]] += x
            b[:, [1, 3]] += y
            boxes.append(b)
            scores.append(s)
    if not boxes:
        return []
    b = torch.from_numpy(np.concatenate(boxes))
    s = torch.from_numpy(np.concatenate(scores))
    keep = torchvision.ops.nms(b, s, net.nms_thresh).numpy()
    b = b.numpy()[keep]
    s = s.numpy()[keep]
    E0 = meta["minEasting"] + c0 * p
    N0 = meta["maxNorthing"] - r0 * p
    out = []
    for (x0, y0, x1, y1), sc in zip(b, s):
        out.append([round(float(E0 + x0 * p), 2), round(float(N0 - y1 * p), 2), round(float(E0 + x1 * p), 2), round(float(N0 - y0 * p), 2), round(float(sc), 4)])
    return out


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_detect(a):
    meta, data = load_raster(a.raster)
    net, _ = build_model(a.weights, a.device, a.score, a.nms)
    if a.regions:
        regions = json.load(open(a.regions))
    else:
        regions = [{"id": "all", "bbox": [meta["minEasting"], meta["maxNorthing"] - meta["height"] * meta["pixelMetres"], meta["minEasting"] + meta["width"] * meta["pixelMetres"], meta["maxNorthing"]]}]
    t = time.time()
    result = {"kind": "photo-crowns", "model": MODEL_NAME, "revision": MODEL_REVISION, "weights": a.weights or "pretrained", "weightsSha256": sha256_of(a.weights) if a.weights else None,
              "raster": {k: meta[k] for k in ("campaign", "date", "pixelMetres", "sha256")}, "patchMetres": a.patch_metres, "overlap": a.overlap, "scoreThreshold": a.score, "nms": a.nms,
              "space": "photo (EPSG:3006 where the orthophoto draws the crown; relief displacement not removed)", "columns": ["minE", "minN", "maxE", "maxN", "score"], "regions": []}
    if a.region_size and not a.regions:
        bb = regions[0]["bbox"]
        step = a.region_size
        regions = []
        e = bb[0]
        while e < bb[2]:
            n = bb[1]
            while n < bb[3]:
                regions.append({"id": f"{int(e)}_{int(n)}", "bbox": [e, n, min(bb[2], e + step + 20), min(bb[3], n + step + 20)], "core": [e, n, e + step, n + step]})
                n += step
            e += step
    total = 0
    for reg in regions:
        crowns = detect_region(net, meta, data, reg["bbox"], a.patch_metres, a.overlap, a.device)
        if "core" in reg:
            c = reg["core"]
            crowns = [b for b in crowns if c[0] <= (b[0] + b[2]) / 2 < c[2] and c[1] <= (b[1] + b[3]) / 2 < c[3]]
        total += len(crowns)
        result["regions"].append({"id": reg["id"], "bbox": reg.get("core", reg["bbox"]), "crowns": crowns})
    result["seconds"] = round(time.time() - t, 1)
    json.dump(result, open(a.out, "w"))
    print(f"{total} crowns in {len(regions)} regions, {result['seconds']} s -> {a.out}")


def clip_boxes(boxes, x0, y0, size, min_keep=0.4):
    out = []
    for b in boxes:
        bx0, by0, bx1, by1 = b
        area = (bx1 - bx0) * (by1 - by0)
        cx0, cy0, cx1, cy1 = max(bx0, x0), max(by0, y0), min(bx1, x0 + size), min(by1, y0 + size)
        if cx1 <= cx0 or cy1 <= cy0:
            continue
        if (cx1 - cx0) * (cy1 - cy0) < min_keep * area:
            continue
        out.append([cx0 - x0, cy0 - y0, cx1 - x0, cy1 - y0])
    return out


def cmd_train(a):
    random.seed(a.seed)
    np.random.seed(a.seed)
    torch.manual_seed(a.seed)
    meta, data = load_raster(a.raster)
    train = json.load(open(a.train))
    assert train["role"] == "calibration only"
    crops = [c for c in train["crops"] if not a.windows or c["window"] in a.windows.split(",")]
    p = meta["pixelMetres"]
    patch = int(round(a.patch_metres / p))
    # optional: move each reference box onto the visible crown the pretrained model drew within --snap-metres
    snap_boxes = []
    if a.snap_to:
        for reg in json.load(open(a.snap_to))["regions"]:
            snap_boxes += [b for b in reg["crowns"] if b[4] >= 0.1]
        snap_boxes = np.array(snap_boxes, dtype=np.float64).reshape(-1, 5)
    snapped = 0
    samples = []
    for c in crops:
        c0, r0, c1, r1 = window_pixels(meta, c["bbox"])
        img = np.array(data[r0:r1, c0:c1, :])
        E0, N0 = meta["minEasting"] + c0 * p, meta["maxNorthing"] - r0 * p
        # ambiguity boxes (canopy not split by the interpreter) are masked out, never taught as background
        for m in c.get("masks", []):
            mc0, mc1 = int(max(0, (m[0] - E0) / p)), int(max(0, (m[2] - E0) / p))
            mr0, mr1 = int(max(0, (N0 - m[3]) / p)), int(max(0, (N0 - m[1]) / p))
            img[mr0:mr1, mc0:mc1] = 0
        world = []
        for b in c["boxes"]:
            bx = [b["xmin"], b["ymin"], b["xmax"], b["ymax"]]
            if len(snap_boxes):
                cx, cy, half = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, (bx[2] - bx[0]) / 2
                sc = (snap_boxes[:, 0] + snap_boxes[:, 2]) / 2
                sr = (snap_boxes[:, 1] + snap_boxes[:, 3]) / 2
                sh = (snap_boxes[:, 2] - snap_boxes[:, 0] + snap_boxes[:, 3] - snap_boxes[:, 1]) / 4
                d = np.hypot(sc - cx, sr - cy)
                ok = (d <= a.snap_metres) & (sh >= 0.5 * half) & (sh <= 2 * half)
                if ok.any():
                    i = int(np.argmin(np.where(ok, d, np.inf)))
                    bx = list(snap_boxes[i, :4])
                    snapped += 1
            world.append(bx)
        boxes = [[(b[0] - E0) / p, (N0 - b[3]) / p, (b[2] - E0) / p, (N0 - b[1]) / p] for b in world]
        samples.append((c["window"], img, boxes))
    if a.snap_to:
        print(f"snapped {snapped} of {sum(len(s[2]) for s in samples)} boxes onto pretrained crowns")
    net, _ = build_model(None, a.device, 0.05, 0.2)
    net.train()
    params = [q for q in net.parameters() if q.requires_grad]
    opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=1e-4)
    log = []
    for epoch in range(a.epochs):
        batch_imgs, batch_tg, losses = [], [], []
        order = [s for s in samples for _ in range(a.per_crop)]
        random.shuffle(order)
        for (wid, img, boxes) in order:
            h, w = img.shape[:2]
            x0 = random.randint(0, max(0, w - patch))
            y0 = random.randint(0, max(0, h - patch))
            t = np.zeros((patch, patch, 3), dtype=np.uint8)
            part = img[y0:y0 + patch, x0:x0 + patch]
            t[:part.shape[0], :part.shape[1]] = part
            bb = clip_boxes(boxes, x0, y0, patch)
            bb = np.array(bb, dtype=np.float32).reshape(-1, 4)
            # flips and quarter turns
            if random.random() < 0.5:
                t = t[:, ::-1]
                bb[:, [0, 2]] = patch - bb[:, [2, 0]]
            if random.random() < 0.5:
                t = t[::-1, :]
                bb[:, [1, 3]] = patch - bb[:, [3, 1]]
            if random.random() < 0.5:
                t = np.transpose(t, (1, 0, 2))
                bb = bb[:, [1, 0, 3, 2]]
            batch_imgs.append(torch.from_numpy(np.ascontiguousarray(t)).permute(2, 0, 1).float().div(255).to(a.device))
            batch_tg.append({"boxes": torch.from_numpy(bb).to(a.device), "labels": torch.zeros(len(bb), dtype=torch.int64, device=a.device)})
            if len(batch_imgs) == a.batch:
                loss = sum(net(batch_imgs, batch_tg).values())
                opt.zero_grad()
                loss.backward()
                opt.step()
                losses.append(float(loss))
                batch_imgs, batch_tg = [], []
        if batch_imgs:
            loss = sum(net(batch_imgs, batch_tg).values())
            opt.zero_grad()
            loss.backward()
            opt.step()
            losses.append(float(loss))
        log.append(round(float(np.mean(losses)), 4))
        print(f"epoch {epoch + 1}: loss {log[-1]}")
    torch.save(net.state_dict(), a.out)
    json.dump({"windows": [s[0] for s in samples], "epochs": a.epochs, "lr": a.lr, "perCrop": a.per_crop, "batch": a.batch, "patchMetres": a.patch_metres, "seed": a.seed, "loss": log, "snapTo": os.path.basename(a.snap_to) if a.snap_to else None, "snapMetres": a.snap_metres, "weightsSha256": sha256_of(a.out), "train": os.path.basename(a.train), "trainSha256": sha256_of(a.train)}, open(a.out + ".json", "w"), indent=1)
    print(f"weights -> {a.out}")


def cmd_info(a):
    import deepforest
    from huggingface_hub import hf_hub_download, HfApi
    info = {"python": sys.version.split()[0], "torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda, "deepforest": deepforest.__version__, "cudaAvailable": torch.cuda.is_available()}
    if torch.cuda.is_available():
        info["device"] = torch.cuda.get_device_name(0)
        info["capability"] = torch.cuda.get_device_capability(0)
    try:
        api = HfApi()
        mi = api.model_info(MODEL_NAME, revision=MODEL_REVISION, files_metadata=True)
        info["model"] = {"id": MODEL_NAME, "sha": mi.sha, "files": [{"name": s.rfilename, "size": s.size, "sha256": (s.lfs.sha256 if s.lfs else None)} for s in mi.siblings]}
    except Exception as e:  # network may be down; the weights hash below still pins them
        info["modelError"] = str(e)
    print(json.dumps(info, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect")
    d.add_argument("--raster", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("--regions")
    d.add_argument("--region-size", type=float, default=0)
    d.add_argument("--weights")
    d.add_argument("--patch-metres", type=float, default=40)
    d.add_argument("--overlap", type=float, default=0.25)
    d.add_argument("--score", type=float, default=0.05)
    d.add_argument("--nms", type=float, default=0.2)
    d.add_argument("--device", default="cuda")
    t = sub.add_parser("train")
    t.add_argument("--raster", required=True)
    t.add_argument("--train", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--windows", default="")
    t.add_argument("--epochs", type=int, default=8)
    t.add_argument("--lr", type=float, default=1e-4)
    t.add_argument("--per-crop", type=int, default=6)
    t.add_argument("--batch", type=int, default=4)
    t.add_argument("--patch-metres", type=float, default=40)
    t.add_argument("--seed", type=int, default=7)
    t.add_argument("--device", default="cuda")
    t.add_argument("--snap-to", default="")
    t.add_argument("--snap-metres", type=float, default=2.5)
    sub.add_parser("info")
    a = ap.parse_args()
    {"detect": cmd_detect, "train": cmd_train, "info": cmd_info}[a.cmd](a)


if __name__ == "__main__":
    main()
