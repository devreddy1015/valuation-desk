"""Recalculate every formula in a Valuation Desk workbook with the independent `formulas` engine and
compare each result with the value the app's engine cached in the cell. Then switch the scenario
picker to bear and check the DCF follows.

Usage (dev only):  python -m venv .venv && .venv/bin/pip install "formulas[excel]"
                   npx tsx --conditions=react-server scripts/excel-probe.mts OUTDIR INFY.NS AAPL
                   .venv/bin/python -I scripts/excel-check.py OUTDIR/INFY.NS.xlsx OUTDIR/INFY.NS.json
"""
import json
import math
import sys

import formulas


def scalar(v):
    v = getattr(v, "value", v)
    if hasattr(v, "tolist"):
        v = v.tolist()
    while isinstance(v, list) and len(v) == 1:
        v = v[0]
    return v.item() if hasattr(v, "item") else v


def solve(path, inputs=None):
    xl = formulas.ExcelModel().loads(path).finish()
    keys = {}
    for k in xl.cells:
        if "!" in k:
            sheet, addr = k.split("!", 1)
            keys[f"{sheet.split(']')[-1].strip(chr(39)).upper()}!{addr}"] = k
    over = {keys[k.upper()]: v for k, v in (inputs or {}).items()}
    sol = xl.calculate(inputs=over) if over else xl.calculate()
    return {name: scalar(sol[k]) for name, k in keys.items() if k in sol}


def same(got, want):
    if isinstance(want, bool) or not isinstance(want, (int, float)):
        return str(got).strip().upper() == str(want).strip().upper()
    return isinstance(got, (int, float)) and not isinstance(got, bool) and math.isfinite(got) and abs(got - want) <= 1e-6 * max(1, abs(want))


def main(path, meta_path):
    meta = json.load(open(meta_path))
    got = solve(path)
    checked, bad = 0, []
    for key, cell in meta["cells"].items():
        if "r" not in cell or isinstance(cell["r"], dict):  # no cached value, or a cached #N/A
            continue
        checked += 1
        g = got.get(key.upper())
        if not same(g, cell["r"]):
            bad.append((key, cell["f"][:90], cell["r"], g))
    print(f"{path.split('/')[-1]}: {checked} formula results compared, {len(bad)} mismatches")
    for b in bad[:25]:
        print("  MISMATCH", b)
    bear = solve(path, {"INPUTS!C23": "bear"}).get("DCF!C51")
    want = meta["engine"]["bear"]
    print(f"  scenario picker -> bear: DCF value {bear}, engine {want}, match {same(bear, want)}")
    return 0 if not bad and same(bear, want) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
