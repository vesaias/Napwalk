"""W1 gate input: per-district surface/smoothness tag coverage, length-weighted."""
import geopandas as gpd
import pandas as pd

from common import REPORTS, WORK, check

COBBLE = {"sett", "cobblestone", "unhewn_cobblestone", "paving_stones:30",
          "cobblestone:flattened", "grass_paver"}


def coverage_by_district(edges, districts):
    e = edges.copy()
    e["mid"] = e.geometry.interpolate(0.5, normalized=True)
    pts = gpd.GeoDataFrame(e.drop(columns="geometry"), geometry=e["mid"], crs=e.crs)
    joined = gpd.sjoin(pts, districts[["name", "geometry"]], how="inner",
                       predicate="within")
    joined["has_surface"] = joined["surface"].notna()
    joined["has_smooth"] = joined["smoothness"].notna()
    joined["is_cobble"] = joined["surface"].isin(COBBLE)
    g = joined.groupby("name", as_index=False).apply(
        lambda d: pd.Series({
            "km_total": d["length"].sum() / 1000,
            "pct_surface": 100 * d.loc[d.has_surface, "length"].sum() / d["length"].sum(),
            "pct_smoothness": 100 * d.loc[d.has_smooth, "length"].sum() / d["length"].sum(),
            "pct_cobble": 100 * d.loc[d.is_cobble, "length"].sum() / d["length"].sum(),
        }), include_groups=False)
    g = g.rename(columns={"name": "district"}).sort_values(
        "pct_surface", ascending=False).reset_index(drop=True)
    return g.round({"km_total": 1, "pct_surface": 1, "pct_smoothness": 1,
                    "pct_cobble": 1})


def main():
    edges = gpd.read_file(WORK / "osm" / "edges.gpkg")
    districts = gpd.read_file(WORK / "osm" / "districts.gpkg")
    out = coverage_by_district(edges, districts)
    # The report is per district where districts exist and citywide where
    # they do not — San Francisco has 9 at admin_level 10 and London none,
    # so a fixed floor of 30 was Frankfurt's 46 in disguise (2026-08-31).
    # Some districts legitimately hold no walkable edge: San Francisco's
    # ninth is the Farallon Islands, 40 km offshore (2026-08-31).
    if len(districts) and len(out) < len(districts):
        print(f"note: {len(districts) - len(out)} of {len(districts)} districts "
              "have no edges")
    check(len(out) or not len(districts), "no district matched any edge")
    REPORTS.mkdir(exist_ok=True)
    out.to_csv(REPORTS / "w1_tag_coverage.csv", index=False)
    total = edges["length"].sum()
    city_surface = 100 * edges.loc[edges.surface.notna(), "length"].sum() / total
    city_smooth = 100 * edges.loc[edges.smoothness.notna(), "length"].sum() / total
    with open(REPORTS / "w1_tag_coverage.md", "w", encoding="utf-8") as f:
        f.write("# W1 tag coverage (length-weighted)\n\n")
        f.write(f"Citywide: surface {city_surface:.1f} %, "
                f"smoothness {city_smooth:.1f} % of edge length.\n\n")
        cols = ["district", "km_total", "pct_surface", "pct_smoothness", "pct_cobble"]
        f.write("| " + " | ".join(cols) + " |\n")
        f.write("|" + "---|" * len(cols) + "\n")
        for _, r in out.iterrows():
            f.write("| " + " | ".join(str(r[c]) for c in cols) + " |\n")
    print(f"citywide surface={city_surface:.1f}% smoothness={city_smooth:.1f}%")


if __name__ == "__main__":
    main()
