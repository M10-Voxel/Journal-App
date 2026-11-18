"""Expand repeated SVG arcs in the bundled Lucide paths for zeno 0.3's parser.

Run after regenerating assets/lucide-icons.txt. Geometry and all other commands
stay unchanged. This is asset preparation, with no work or extra library at runtime.
"""
from pathlib import Path
import re

NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
ARITY = dict(m=2, l=2, h=1, v=1, c=6, s=4, q=4, t=2, a=7)


def explicit_arcs(path: str) -> str:
    pos, command, repeated = 0, "", False
    insertions = []
    while pos < len(path):
        while pos < len(path) and (path[pos].isspace() or path[pos] == ","):
            pos += 1
        if pos == len(path):
            break
        if path[pos].isalpha():
            command = path[pos]
            pos += 1
            repeated = False
            if command.lower() == "z":
                continue
        elif repeated and command.lower() == "a":
            insertions.append((pos, command))
        for argument in range(ARITY[command.lower()]):
            while pos < len(path) and (path[pos].isspace() or path[pos] == ","):
                pos += 1
            if command.lower() == "a" and argument in (3, 4):
                assert path[pos] in "01", (path, pos)
                pos += 1
            else:
                number = NUMBER.match(path, pos)
                assert number, (path, pos)
                pos = number.end()
        repeated = True
    for pos, command in reversed(insertions):
        path = path[:pos] + command + path[pos:]
    return path


if __name__ == "__main__":
    source = Path(__file__).resolve().parent.parent / "assets/lucide-icons.txt"
    rows = [line.split("\t", 1) for line in source.read_text(encoding="utf-8").splitlines()]
    normalized = [(name, explicit_arcs(path)) for name, path in rows]
    changed = sum(before != after for before, after in zip(rows, map(list, normalized)))
    source.write_text("".join(f"{name}\t{path}\n" for name, path in normalized), encoding="utf-8", newline="\n")
    print(f"Normalized repeated arcs in {changed} icons.")
