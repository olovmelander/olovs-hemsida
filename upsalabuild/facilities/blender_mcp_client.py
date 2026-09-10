"""Send a local Python file to the user's Blender MCP socket.

Only sends explicitly supplied code; it never starts or replaces Blender.
"""
import argparse
import json
from pathlib import Path
import socket


def request(command, params, port=9876, timeout=60):
    with socket.create_connection(("127.0.0.1", port), timeout=8) as connection:
        connection.settimeout(timeout)
        connection.sendall(json.dumps({"type": command, "params": params}).encode("utf-8"))
        payload = bytearray()
        while len(payload) < 32 * 1024 * 1024:
            data = connection.recv(65536)
            if not data:
                raise RuntimeError("Blender closed the connection before a complete response")
            payload.extend(data)
            try:
                response = json.loads(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if response.get("status") != "success":
                raise RuntimeError(response.get("message", str(response)))
            return response
        raise RuntimeError("Blender response exceeded 32 MiB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", type=Path)
    parser.add_argument("--port", type=int, default=9876)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    response = request("execute_code", {"code": args.script.read_text(encoding="utf-8")}, args.port, args.timeout) if args.script else request("get_scene_info", {}, args.port, args.timeout)
    serialized = json.dumps(response, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized)
