"""Copies the part of Mortal's libriichi that the encoder needs and removes its
Python layer (pyo3 / numpy), so that it builds for WebAssembly.

Usage: python3 strip_pyo3.py <Mortal checkout> <output dir>
The result is mortal/libriichi/src in this repository. Every change is
mechanical: Python attributes and the functions that take Python types go,
everything else stays byte for byte.
"""
import re
import shutil
import sys
from pathlib import Path

KEEP = [
    'algo', 'state', 'mjai/event.rs', 'tile.rs', 'hand.rs', 'consts.rs',
    'macros.rs', 'array.rs', 'vec_ops.rs', 'chi_type.rs', 'rankings.rs',
]
SKIP = {'state/test.rs'}

ATTR = re.compile(r'^\s*#\[(pyclass|pymethods|pyfunction|pymodule|new|getter|setter|staticmethod|classmethod)\b[^\]]*\]\s*$')
PYO3_ATTR = re.compile(r'^\s*#\[pyo3\(.*\)\]\s*$')
USE = re.compile(r'^\s*use (pyo3|numpy|crate::py_helper)\b.*;\s*$')
PY_SIG = re.compile(r'\b(Python<|Bound<|PyResult|PyObject|PyModule|PyArray)')


def drop_py_functions(text):
    """Removes every fn whose signature mentions a Python type."""
    out = []
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r'^\s*(pub(\([^)]*\))? )?(const )?fn \w+', line):
            # gather the signature up to the opening brace
            j = i
            sig = line
            while '{' not in lines[j] and j + 1 < len(lines):
                j += 1
                sig += lines[j]
            if PY_SIG.search(sig):
                # drop doc comments / attributes directly above
                while out and re.match(r'^\s*(///|#\[)', out[-1]):
                    out.pop()
                depth = 0
                k = i
                while True:
                    depth += lines[k].count('{') - lines[k].count('}')
                    if depth == 0 and '{' in ''.join(lines[i:k + 1]):
                        break
                    k += 1
                i = k + 1
                continue
        out.append(line)
        i += 1
    return '\n'.join(out)


def strip(text):
    text = drop_py_functions(text)
    lines = [l for l in text.split('\n') if not (ATTR.match(l) or PYO3_ATTR.match(l) or USE.match(l))]
    text = '\n'.join(lines)
    text = text.replace('#[cfg(test)]\nmod test;\n', '')
    return text


def main():
    src = Path(sys.argv[1]) / 'libriichi' / 'src'
    dst = Path(sys.argv[2])
    if dst.exists():
        shutil.rmtree(dst)
    for item in KEEP:
        p = src / item
        files = [p] if p.is_file() else [f for f in p.rglob('*') if f.is_file()]
        for f in files:
            rel = f.relative_to(src)
            if str(rel) in SKIP:
                continue
            out = dst / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if f.suffix == '.rs':
                out.write_text(strip(f.read_text()))
            else:
                shutil.copyfile(f, out)
    # mjai/mod.rs: only the event types
    (dst / 'mjai' / 'mod.rs').write_text(
        'mod event;\n\npub use event::{Event, EventExt, EventWithCanAct, Metadata, OutOfBoundError};\n')


if __name__ == '__main__':
    main()
