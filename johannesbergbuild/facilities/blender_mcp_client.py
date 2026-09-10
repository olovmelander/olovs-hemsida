"""Send an explicit script to the existing localhost Blender bridge."""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, port=9876, timeout=90):
    with socket.create_connection(('127.0.0.1', port), timeout=8) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({'type': command, 'params': params}).encode('utf-8'))
        payload = bytearray()
        while len(payload) < 32 * 1024 * 1024:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Blender closed the connection without a complete response')
            payload.extend(chunk)
            try:
                response = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if response.get('status') != 'success' or response.get('result', {}).get('executed') is False:
                raise RuntimeError(str(response))
            return response
        raise RuntimeError('Blender response exceeded 32 MiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--script', type=Path)
    action.add_argument('--spec', type=Path, help='Build a new reference scene from a pinned specification')
    parser.add_argument('--port', type=int, default=9876)
    parser.add_argument('--timeout', type=int, default=90)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.spec:
        builder = Path(__file__).resolve().with_name('build_blender_reference.py')
        code = f"import runpy\nrunpy.run_path({str(builder)!r})['build']({str(args.spec.resolve())!r})"
        response = request('execute_code', {'code': code}, args.port, args.timeout)
    elif args.script:
        response = request('execute_code', {'code': args.script.read_text(encoding='utf-8-sig')}, args.port, args.timeout)
    else:
        response = request('get_scene_info', {}, args.port, args.timeout)
    text = json.dumps(response, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding='utf-8', newline='\n')
    print(text)
