import sys
filepath = sys.argv[1] if len(sys.argv) > 1 else "apps/extension-chromium/src/sidepanel.tsx"
key_lines = [3902, 5040, 5045, 5882, 6707, 7745, 8296, 8334]
with open(filepath, "r", encoding="utf-8") as f:
    lines = f.readlines()
brace_open = brace_close = paren_open = paren_close = 0
results = []
for i, line in enumerate(lines, 1):
    brace_open += line.count("{")
    brace_close += line.count("}")
    paren_open += line.count("(")
    paren_close += line.count(")")
    if i in key_lines:
        results.append((i, brace_open, brace_close, paren_open, paren_close))
print("=== Brace counts ===")
print("Total { :", brace_open)
print("Total } :", brace_close)
print("Imbalance:", brace_open - brace_close)
print()
print("=== Paren counts ===")
print("Total ( :", paren_open)
print("Total ) :", paren_close)
print("Imbalance:", paren_open - paren_close)
print()
print("=== Cumulative at key lines ===")
for ln, bo, bc, po, pc in results:
    print(f"{ln:>6} | {{ {bo:>6} }} {bc:>6} ( {po:>6} ) {pc:>6} | brace_net={bo-bc} paren_net={po-pc}")
