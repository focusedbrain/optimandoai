"""Read-only realm-distribution inventory over the local handshake ledger.

Phase 1 report input (risk register: identity-guard tightening vs
multi-realm setups). Prints counts and issuer hosts only - no emails,
subjects, or tokens.
"""
import sqlite3
import json
import sys
from collections import Counter
from urllib.parse import urlparse

DB = r"C:/Users/oscar/.opengiraffe/electron-data/handshake-ledger.db"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
if "handshakes" not in tables:
    print(json.dumps({"error": "no handshakes table", "tables": tables}))
    sys.exit(0)

cols = [r[1] for r in cur.execute("PRAGMA table_info(handshakes)")]
rows = cur.execute("SELECT * FROM handshakes").fetchall()

def host(iss):
    iss = (iss or "").strip()
    if not iss:
        return None
    try:
        return urlparse(iss).netloc or iss
    except Exception:
        return iss

def party(row, prefix):
    idx = {c: i for i, c in enumerate(cols)}
    if f"{prefix}_json" in idx:
        raw = row[idx[f"{prefix}_json"]]
        if raw:
            try:
                return json.loads(raw)
            except Exception:
                return None
    out = {}
    for claim in ("iss", "sub", "email", "wrdesk_user_id"):
        col = f"{prefix}_{claim}"
        if col in idx:
            out[claim] = row[idx[col]]
    return out or None

idx = {c: i for i, c in enumerate(cols)}
by_state = Counter()
by_type = Counter()
issuer_hosts = Counter()
init_iss_missing = 0
acc_iss_missing = 0
cross_realm = 0
same_sub_diff_iss = 0
same_email_diff_iss = 0
has_acceptor = 0

for row in rows:
    state = row[idx["state"]] if "state" in idx else "?"
    by_state[state] += 1
    htype = (row[idx["handshake_type"]] if "handshake_type" in idx else None) or "standard"
    by_type[htype] += 1
    ini = party(row, "initiator") or {}
    acc = party(row, "acceptor")
    hi = host(ini.get("iss"))
    ha = host(acc.get("iss")) if acc else None
    if hi:
        issuer_hosts[hi] += 1
    if ha:
        issuer_hosts[ha] += 1
    if not hi:
        init_iss_missing += 1
    if acc is not None:
        has_acceptor += 1
        if not ha:
            acc_iss_missing += 1
        if hi and ha and hi != ha:
            cross_realm += 1
            if (ini.get("sub") or "") and ini.get("sub") == acc.get("sub"):
                same_sub_diff_iss += 1
            if (ini.get("email") or "").lower() and (ini.get("email") or "").lower() == (acc.get("email") or "").lower():
                same_email_diff_iss += 1

print(json.dumps({
    "total_rows": len(rows),
    "by_state": dict(by_state),
    "by_type": dict(by_type),
    "rows_with_acceptor": has_acceptor,
    "distinct_issuer_hosts": sorted(issuer_hosts),
    "issuer_host_party_counts": dict(issuer_hosts),
    "rows_initiator_iss_missing": init_iss_missing,
    "rows_acceptor_iss_missing": acc_iss_missing,
    "rows_cross_realm_pair": cross_realm,
    "cross_realm_same_sub": same_sub_diff_iss,
    "cross_realm_same_email": same_email_diff_iss,
}, indent=2))
