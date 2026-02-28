import os
import json
import argparse
from datetime import datetime, timezone
from flask import Flask, jsonify, request, render_template, send_from_directory

app = Flask(__name__)

# ── Paths (resolved at startup, see __main__ block) ───────────────
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
FRAMES_DIR     = None   # set by CLI arg --frames
ANNOTATIONS_DIR = None  # set alongside FRAMES_DIR


def get_annotation_path(video_id):
    return os.path.join(ANNOTATIONS_DIR, f'{video_id}.json')


def load_annotation(video_id):
    path = get_annotation_path(video_id)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {'video_id': video_id, 'selected_frames': [], 'history': [], 'last_modified': None}


def save_annotation(video_id, data):
    path = get_annotation_path(video_id)
    data['last_modified'] = datetime.now(timezone.utc).isoformat()
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_path, path)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/videos')
def list_videos():
    videos = []
    for entry in os.scandir(FRAMES_DIR):
        if entry.is_dir():
            frames = sorted([
                f.name for f in os.scandir(entry.path)
                if f.name.endswith('.jpg')
            ])
            ann = load_annotation(entry.name)
            selected_count = len(ann.get('selected_frames', []))
            status = ann.get('status', None)
            # Backward compat: if no status field but completed=True, treat as 'done'
            if status is None and ann.get('completed', False):
                status = 'done'
            completed = (status == 'done')
            difficulty = ann.get('difficulty', None)
            videos.append({
                'id': entry.name,
                'frame_count': len(frames),
                'selected_count': selected_count,
                'annotated': selected_count > 0,
                'completed': completed,
                'status': status,
                'difficulty': difficulty,
            })
    # Sort order:
    #   0 = in-progress (has annotations, status=null)  ← first
    #   1 = untouched   (no annotations, status=null)
    #   2 = skip
    #   3 = review
    #   4 = done                                        ← last
    def sort_key(v):
        s = v['status']
        if s == 'skip':
            return (2, v['id'])
        elif s == 'review':
            return (3, v['id'])
        elif s == 'done':
            return (4, v['id'])
        elif v['annotated']:
            return (0, v['id'])
        else:
            return (1, v['id'])
    videos.sort(key=sort_key)
    return jsonify(videos)


@app.route('/api/video/<video_id>/frames')
def get_frames(video_id):
    video_dir = os.path.join(FRAMES_DIR, video_id)
    if not os.path.isdir(video_dir):
        return jsonify({'error': 'Video not found'}), 404
    frames = sorted([
        f.name for f in os.scandir(video_dir)
        if f.name.endswith('.jpg')
    ])
    return jsonify(frames)


@app.route('/frames/<video_id>/<filename>')
def serve_frame(video_id, filename):
    video_dir = os.path.join(FRAMES_DIR, video_id)
    return send_from_directory(video_dir, filename)


@app.route('/api/annotation/<video_id>', methods=['GET'])
def get_annotation(video_id):
    return jsonify(load_annotation(video_id))


@app.route('/api/annotation/<video_id>', methods=['POST'])
def save_annotation_route(video_id):
    data = request.get_json()
    if data is None:
        return jsonify({'error': 'Invalid JSON'}), 400
    data['video_id'] = video_id
    save_annotation(video_id, data)
    return jsonify({'ok': True})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='HICE Annotation Tool')
    parser.add_argument(
        '--frames', '-f',
        default=os.path.join(BASE_DIR, 'outdoor_frames'),
        help='Path to the frames directory (default: ./outdoor_frames). '
             'Must contain one sub-folder per video, each filled with JPEG frames.'
    )
    parser.add_argument(
        '--annotations', '-a',
        default=None,
        help='Path to save annotation JSON files (default: <frames_dir>/../annotations).'
    )
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind (default: 0.0.0.0)')
    parser.add_argument('--port', '-p', type=int, default=5000, help='Port (default: 5000)')
    args = parser.parse_args()

    FRAMES_DIR = os.path.abspath(args.frames)
    if not os.path.isdir(FRAMES_DIR):
        raise SystemExit(f'[ERROR] Frames directory not found: {FRAMES_DIR}')

    ANNOTATIONS_DIR = os.path.abspath(
        args.annotations if args.annotations
        else os.path.join(os.path.dirname(FRAMES_DIR), 'annotations')
    )
    os.makedirs(ANNOTATIONS_DIR, exist_ok=True)

    print(f'  Frames dir     : {FRAMES_DIR}')
    print(f'  Annotations dir: {ANNOTATIONS_DIR}')
    print(f'  Listening on   : http://{args.host}:{args.port}')

    app.run(host=args.host, port=args.port, debug=False)
