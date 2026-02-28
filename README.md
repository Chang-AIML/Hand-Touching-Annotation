# HICE Annotation Tool

A lightweight, browser-based tool for annotating key frames in video sequences (pre-extracted JPEG frames). No GPU, no heavy dependencies — just Python + Flask.

---

## Requirements

- Python 3.8+
- A modern browser (Chrome / Firefox / Edge)

---

## Installation

```bash
# 1. Clone or copy this repository
git clone <repo-url>
cd HICE_Annotation_Tool

# 2. Install dependencies (a virtual environment is recommended)
pip install -r requirements.txt
```

---

## Data Format

Your frames directory must follow this structure:

```
<frames_dir>/
├── video_id_001/          # one folder per video (any name)
│   ├── 000000.jpg
│   ├── 000001.jpg
│   └── ...
├── video_id_002/
│   └── ...
└── ...
```

- Each sub-folder = one video sequence.
- Frames must be **JPEG** files (`.jpg`).
- Frame filenames can be anything sortable (e.g. zero-padded numbers like `000418.jpg`). They do **not** need to start from `000000`.
- Frame resolution can be anything; the player scales automatically.

---

## Running

```bash
python app.py --frames /path/to/your/frames/directory
```

Then open **http://localhost:5000** in your browser.

### All options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--frames` | `-f` | `./outdoor_frames` | Path to the frames directory |
| `--annotations` | `-a` | `<frames_dir>/../annotations` | Where to save annotation JSON files |
| `--port` | `-p` | `5000` | Port to listen on |
| `--host` | | `0.0.0.0` | Host to bind |

### Examples

```bash
# Use default ./outdoor_frames, port 5000
python app.py

# Custom frames directory
python app.py --frames /dataset

# Custom frames + custom annotation save path
python app.py --frames /dataset --annotations /data/my_annotations

# Different port
python app.py --frames /dataset --port 8080
```

---

## Interface Overview

```
┌─────────────────┬────────────────────────────────┬──────────────┐
│   Video List    │         Frame Player            │   Labeled    │
│                 │                                 │   Frames     │
│  • video_001  3 │   [canvas: current frame]       │  000418.jpg  │
│  • video_002    │                                 │  002341.jpg  │
│  • video_003    │   ████████████░░░░░░░░░░░░░░    │              │
│    ...          │   [progress bar + markers]      │              │
│                 │                                 │              │
│                 │  Frame 42/3638  000418.jpg       │              │
│                 │  ▶Play  ✓Label  ↩Undo           │              │
│                 │  ★Done  ⊘Skip  👁Review          │              │
│                 │  Difficulty: Easy Medium Hard    │              │
│                 │            Extreme              │              │
└─────────────────┴────────────────────────────────┴──────────────┘
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Step one frame back / forward (auto-pauses) |
| `Enter` | Label the current frame |
| `Ctrl+Z` | Undo last labeled frame |
| `Backspace` | Remove the closest labeled frame to the current position (no-op if equidistant) |

---

## Annotation Features

### Labeling frames
- Navigate to a frame and press **Enter** (or click **✓ Label Frame**).
- Labeled frames appear as **yellow diamond markers** on the progress bar.
- The player automatically **slows down** (default 5 FPS) within ±5 frames of any labeled frame, so you don't miss it during playback.

### Video status (mutually exclusive, click again to deselect)
| Button | Meaning | Sidebar color |
|--------|---------|---------------|
| ★ Mark Done | Annotation complete | Green |
| ⊘ Skip | Skip for now, revisit later | Gray |
| 👁 Review | Needs review / quality check | Orange |

Videos with a status set are pushed toward the **bottom of the list**, keeping unfinished work at the top.

### Difficulty rating (mutually exclusive)
Rate the annotation difficulty of each video:

| Label | Color |
|-------|-------|
| Easy | Blue |
| Medium | Violet |
| Hard | Pink |
| Extreme | Red |

The difficulty tag is shown next to the video name in the sidebar.

---

## Annotation Output

Each video gets a JSON file saved to the annotations directory:

```json
{
  "video_id": "video_id_001",
  "selected_frames": ["000418", "002341"],
  "status": "done",
  "difficulty": "hard",
  "completed": true,
  "history": [
    { "action": "select",        "frame": "000418",  "timestamp": "2026-02-28T10:00:00Z" },
    { "action": "select",        "frame": "002341",  "timestamp": "2026-02-28T10:01:00Z" },
    { "action": "set_status",    "status": "done",   "timestamp": "2026-02-28T10:02:00Z" },
    { "action": "set_difficulty","difficulty": "hard","timestamp": "2026-02-28T10:02:05Z" }
  ],
  "last_modified": "2026-02-28T10:02:05Z"
}
```

- `selected_frames` — the current valid set of labeled frames (filename without `.jpg`)
- `status` — `null` / `"done"` / `"skip"` / `"review"`
- `difficulty` — `null` / `"easy"` / `"medium"` / `"hard"` / `"extreme"`
- `history` — append-only full audit trail of every action

---

## Sidebar Sort Order

The video list is always sorted as:

1. **In-progress** — has labeled frames, no status set
2. **Untouched** — no labeled frames, no status set
3. **Skip**
4. **Review**
5. **Done**

---

## Notes

- Annotation files are written atomically (write to `.tmp` then rename), so interruptions won't corrupt data.
- Page refresh automatically resumes the first in-progress video at its last labeled frame, in a paused state.
- The FPS sliders (top-right) control normal playback speed and the near-label slow-down speed independently.


##### *Developed by Chang Dong (chang.dong@adelaide.edu.au), Huy Anh Nguyen (huyanh.nguyen@adelaide.edu.au)· [BBVisual Lab](https://minhhoai.net/lab.html) · University of Adelaide*
---