"""Receive ordered PNG frames and encode a verified MP4 using FFmpeg."""
import argparse
from datetime import datetime
from fractions import Fraction
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
MAX_REQUEST_BYTES = 16 * 1024 * 1024


class Capture:
    def __init__(self, output, previews=False):
        self.output = output
        self.partial = output.with_suffix('.partial.mp4')
        self.previews = previews
        self.encoder = None
        self.log = None
        self.metadata = None
        self.hashes = []
        self.completed = False

    def start(self, metadata):
        if self.metadata is not None:
            raise ValueError('This receiver has already started a capture; restart it for another video')
        frames = metadata.get('totalFrames')
        if type(frames) is not int or not 1 <= frames <= 108000 or metadata.get('fps') != 30:
            raise ValueError('Expected 1–108000 frames at 30 fps')
        if self.output.exists() or self.partial.exists():
            raise ValueError('Output or partial file already exists; choose another filename')
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.metadata = metadata
        self.preview_frames = {0, 1, frames - 2, frames - 1}
        self.preview_frames.update(range(0, frames, 5 * metadata['fps']))
        self.log = self.output.with_suffix('.log').open('wb')
        self.encoder = subprocess.Popen([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-n',
            '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-threads', '2', '-i', 'pipe:0',
            '-frames:v', str(frames), '-an', '-c:v', 'libx264',
            '-threads', '2', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart', str(self.partial),
        ], stdin=subprocess.PIPE, stderr=self.log)
        return {'ready': True}

    def append(self, index, data):
        if self.encoder is None or self.completed:
            raise ValueError('No active capture')
        if index != len(self.hashes) or index >= self.metadata['totalFrames']:
            raise ValueError(f'Unexpected frame {index}; expected {len(self.hashes)}')
        if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
            raise ValueError('Expected a PNG frame')
        if int.from_bytes(data[16:20], 'big') != 1024 or int.from_bytes(data[20:24], 'big') != 1024:
            raise ValueError('Expected 1024 × 1024 pixels')
        if self.encoder.poll() is not None:
            raise RuntimeError('FFmpeg stopped unexpectedly; see the export log')
        # This write applies encoder backpressure before acknowledging the frame.
        self.encoder.stdin.write(data)
        self.encoder.stdin.flush()
        self.hashes.append(hashlib.sha256(data).hexdigest())
        if self.previews and index in self.preview_frames:
            directory = self.output.with_suffix('')
            directory.mkdir(exist_ok=True)
            (directory / f'frame-{index:04d}.png').write_bytes(data)
        if len(self.hashes) % 60 == 0:
            print(f'Captured {len(self.hashes)}/{self.metadata["totalFrames"]}', flush=True)
        return {'frame': index}

    def finish(self, details):
        if self.encoder is None or self.completed:
            raise ValueError('No active capture')
        frames = self.metadata['totalFrames']
        if len(self.hashes) != frames:
            raise ValueError(f'Incomplete capture: {len(self.hashes)}/{frames}')
        self.encoder.stdin.close()
        if self.encoder.wait(timeout=120) != 0:
            raise RuntimeError('FFmpeg failed; see the export log')
        self.log.close()
        probe = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-count_frames', '-show_entries',
            'stream=width,height,nb_read_frames,avg_frame_rate:format=duration',
            '-of', 'json', str(self.partial),
        ], timeout=60))
        stream = probe['streams'][0]
        if (int(stream['nb_read_frames']) != frames
                or (stream['width'], stream['height']) != (1024, 1024)
                or Fraction(stream['avg_frame_rate']) != 30
                or abs(float(probe['format']['duration']) - frames / 30) > .001):
            raise RuntimeError('Encoded video failed frame count, dimensions, or duration verification')
        if self.output.exists():
            raise ValueError('Output appeared during capture; refusing to overwrite it')
        report = {
            **self.metadata, **details, 'frames': frames,
            'uniqueSourceFrames': len(set(self.hashes)), 'probe': probe,
            'sourceFrameSHA256': self.hashes,
        }
        # Identical images can be legitimate (e.g. a stationary scene). Ordered
        # receipts and decoded frame count establish that none were dropped.
        self.output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
        self.partial.rename(self.output)
        self.completed = True
        print(f'Complete: {self.output}', flush=True)
        return {'complete': True, 'frames': frames, 'path': str(self.output)}

    def abort(self):
        if self.encoder is not None and self.encoder.poll() is None:
            self.encoder.terminate()
            try:
                self.encoder.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.encoder.kill()
                self.encoder.wait()
        if self.encoder is not None and not self.encoder.stdin.closed:
            try:
                self.encoder.stdin.close()
            except BrokenPipeError:
                pass
        if self.log is not None and not self.log.closed:
            self.log.close()
        if self.metadata is not None and not self.completed:
            self.partial.unlink(missing_ok=True)
        self.encoder = None


def make_handler(capture, origin):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '86400')
            self.end_headers()

        def reply(self, data, status=200):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self):
            if self.headers.get('Origin', origin) != origin:
                self.reply({'error': 'Unexpected origin'}, 403)
                return
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 <= length <= MAX_REQUEST_BYTES:
                    raise ValueError('Request is too large')
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError('Incomplete request body')
                if self.path == '/start':
                    result = capture.start(json.loads(body))
                elif self.path.startswith('/frame/'):
                    result = capture.append(int(self.path.rsplit('/', 1)[1]), body)
                elif self.path == '/finish':
                    result = capture.finish(json.loads(body))
                elif self.path == '/abort':
                    capture.abort()
                    result = {'aborted': True}
                else:
                    self.reply({'error': 'Not found'}, 404)
                    return
                self.reply(result)
            except (ValueError, KeyError, TypeError) as error:
                self.reply({'error': str(error)}, 400)
            except Exception as error:
                capture.abort()
                self.reply({'error': str(error)}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default = f'exports/tangle-{datetime.now():%Y%m%d-%H%M%S}.mp4'
    parser.add_argument('output', nargs='?', default=default, help='MP4 path relative to the project root')
    parser.add_argument('--port', type=int, default=8005)
    parser.add_argument('--origin', default='http://localhost:8004', help='Origin serving the experiment')
    parser.add_argument('--previews', action='store_true', help='Save selected PNGs next to the video')
    args = parser.parse_args()
    for binary in ('ffmpeg', 'ffprobe'):
        if shutil.which(binary) is None:
            parser.error(f'{binary} is required on PATH')
    output = (ROOT / args.output).resolve()
    if output.suffix.lower() != '.mp4':
        parser.error('Output must end in .mp4')
    capture = Capture(output, args.previews)
    server = HTTPServer(('127.0.0.1', args.port), make_handler(capture, args.origin))
    print(f'Capture receiver: http://localhost:{args.port}\nOutput: {output}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        capture.abort()
        server.server_close()


if __name__ == '__main__':
    main()
