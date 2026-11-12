"""Join the empty-water tail to the opening, preserving continuous motion at the loop."""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='MP4 produced by capture-server.py')
    parser.add_argument('output', type=Path, help='Final looping MP4')
    args = parser.parse_args()
    metadata = json.loads(args.source.with_suffix('.json').read_text())
    frames = metadata['frames']
    fps = metadata['fps']
    blend = metadata['loopBlendFrames']
    if frames <= 2 * blend:
        parser.error('Capture is too short for the loop overlap')
    if args.output.exists() or args.output.with_suffix('.json').exists():
        parser.error('Output exists; choose another filename')
    tail = frames - blend
    # Move the opening overlap to the end. The last blended frame is exactly
    # the opening's frame blend-1; playback then continues at frame blend.
    alpha = f'min(1,(T+1/{fps})/({blend}/{fps}))'
    graph = (
        '[0:v]split=3[middle][tail][head];'
        f'[middle]trim=start_frame={blend}:end_frame={tail},setpts=PTS-STARTPTS[m];'
        f'[tail]trim=start_frame={tail}:end_frame={frames},setpts=PTS-STARTPTS[t];'
        f'[head]trim=start_frame=0:end_frame={blend},setpts=PTS-STARTPTS[h];'
        f"[t][h]blend=all_expr='A*(1-({alpha}))+B*({alpha})'[wrap];"
        '[m][wrap]concat=n=2:v=1:a=0[out]'
    )
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-n',
        '-i', str(args.source), '-filter_complex', graph, '-map', '[out]',
        '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'medium',
        '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(args.output),
    ], check=True)
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_entries',
        'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration',
        '-of', 'json', str(args.output),
    ]))
    stream = probe['streams'][0]
    output_frames = frames - blend
    if (int(stream['nb_read_frames']) != output_frames
            or (stream['width'], stream['height']) != (1024, 1024)
            or stream['avg_frame_rate'] != f'{fps}/1'
            or abs(float(probe['format']['duration']) - output_frames / fps) > .001):
        raise RuntimeError('Loop encoding failed verification')
    events = [{**event, 'time': event['time'] - blend / fps}
              for event in metadata.get('events', []) if event['time'] >= blend / fps]
    report = {
        **{k: v for k, v in metadata.items()
           if k not in ('sourceFrameSHA256', 'uniqueSourceFrames', 'elapsedSeconds')},
        'source': str(args.source), 'sourceFrames': frames,
        'sourceUniqueFrames': metadata['uniqueSourceFrames'],
        'sourceDuration': metadata['duration'], 'sourceEvents': metadata.get('events', []),
        'frames': output_frames, 'totalFrames': output_frames,
        'duration': output_frames / fps, 'events': events, 'probe': probe,
        'loop': {
            'overlapFrames': blend,
            'overlapSeconds': blend / fps,
            'method': 'Circular crossfade in empty water after every chain body clears the view',
            'firstSourceFrame': blend,
            'lastSourceFrame': blend - 1,
        },
    }
    args.output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'path': str(args.output), 'frames': output_frames, 'seconds': output_frames / fps}))


if __name__ == '__main__':
    main()
