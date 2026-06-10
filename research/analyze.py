import json, statistics as st

SUBJECT_PID = 659881
TAX_RATE = 0.0179  # approx combined Frisco/Denton Co. rate; estimate only

pool = json.load(open("data/pool.json"))["features"]
rows = [f["attributes"] for f in pool]

def psf(r):
    return r["ownerAppraisedValue"] / r["imprvMainArea"]

subj = next(r for r in rows if r["pid"] == SUBJECT_PID)
s_val, s_sqft, s_yr, s_cls = (subj["ownerAppraisedValue"], subj["imprvMainArea"],
                              subj["imprvActualYearBuilt"], subj["imprvClasses"])
s_psf = psf(subj)

others = [r for r in rows if r["pid"] != SUBJECT_PID]

# Method 1: whole-neighborhood median $/sqft
nbhd_psf = [psf(r) for r in others]
med_all = st.median(nbhd_psf)

# Method 2: refined comps — similar size (+/-20%), year (+/-12), prefer same class
def similar(r):
    return (abs(r["imprvMainArea"] - s_sqft) <= 0.20 * s_sqft and
            abs((r["imprvActualYearBuilt"] or 0) - s_yr) <= 12)
comps = [r for r in others if similar(r)]
comps.sort(key=psf)
comp_psf = [psf(r) for r in comps]
med_comps = st.median(comp_psf)

def line(label, med):
    ind = med * s_sqft
    red = s_val - ind
    return (f"{label}\n"
            f"   median $/sqft        : ${med:,.2f}\n"
            f"   indicated value      : ${ind:,.0f}\n"
            f"   reduction vs current : ${red:,.0f}"
            + (f"   (~${red*TAX_RATE:,.0f}/yr tax)\n" if red > 0 else "   (no reduction indicated)\n"))

print("="*64)
print(f"SUBJECT  pid {SUBJECT_PID}  {subj['situs_full_address']}")
print(f"  2026 appraised value : ${s_val:,}")
print(f"  living area          : {s_sqft:,.0f} sqft   built {s_yr}   class {s_cls}")
print(f"  subject $/sqft       : ${s_psf:,.2f}")
print("="*64)
print(f"\nNeighborhood SF0414A: {len(others)} comparable A1 homes\n")
print(line(f"METHOD 1 — full neighborhood median ({len(others)} homes):", med_all))
print(line(f"METHOD 2 — refined comps (size +/-20%, age +/-12yr; n={len(comps)}):", med_comps))

# subject rank
ranked = sorted(others + [subj], key=psf, reverse=True)
rank = [r["pid"] for r in ranked].index(SUBJECT_PID) + 1
print(f"Subject ranks #{rank} of {len(ranked)} by $/sqft (1 = highest-taxed per sqft).")
pct = sum(1 for r in others if psf(r) < s_psf)/len(others)*100
print(f"Subject is appraised higher per sqft than {pct:.0f}% of the neighborhood.\n")

print("Lowest-$/sqft similar comps (your best equity evidence):")
print(f"{'addr':<34}{'sqft':>6}{'yr':>6}{'cls':>5}{'appraised':>12}{'$/sqft':>9}")
for r in comps[:10]:
    print(f"{r['situs_full_address'][:33]:<34}{r['imprvMainArea']:>6.0f}{(r['imprvActualYearBuilt'] or 0):>6}"
          f"{(r['imprvClasses'] or ''):>5}{r['ownerAppraisedValue']:>12,}{psf(r):>9.2f}")
