"""The pipeline's twin of web/src/cities.ts (CLAUDE.md rule 2).

One list of literals. Only what genuinely differs between cities lives here:
the OSM place string, the projected CRS, the timezone, and the centre (lng,
lat) the sun is computed at — 10_sun_shade had Frankfurt's observer
hardcoded, which over another city's DSM would have produced entirely wrong
shadows without erroring. The router, the
cost model and the artifact format do not vary and take no city parameter.

The web registry carries centre and bounds for the map; this one carries what
batch work needs. They are two views of the same list, deliberately not one
shared file — the web build must not depend on Python, and the pipeline must
not parse TypeScript.

"bounds" (west, south, east, north) is the one field copied verbatim from
web/src/cities.ts, where it is the map's maxBounds. It lives here too
because 21_basemap_extract must cover everything the map can pan to, and
the place polygon is not always that: Frankfurt's maxBounds reaches 5.7 km
further east than the city boundary, which would have left the basemap
ending in white inside the pannable box. Keep the two lists equal — a
mismatch shows up as blank map at one edge, not as an error.

"clip" (optional) is a list of named areas whose union replaces the place
polygon — for a city whose full extent is too much graph (London).

"shade_year" / "noise_year" (both optional) are the survey year of the DSM
and the mapping round of the noise map — the two facts the city sheet shows
beside a city's download size (CR-03 Q5, 2026-09-09). They are the twin of
`shadeYear`/`noiseYear` in web/src/cities.ts and must stay equal to it. Only
written where a file in this repo STATES the year (the source is on each
line); the 2026-09-06 attribution audit's rule applies — a year we cannot
point at is a guess, and a wrong survey year under a shade claim is worse
than a blank. Nothing in the pipeline reads them yet: they live here because
the two registries are two views of one list, not because a stage needs them.

"budget_mib" is the brotli cap 08_export_graph enforces, on the SUM over the
core and every shade band — what a city costs to hold in full, which since
v8 is not what a session downloads. It was one 12 MiB number until
2026-09-01, when the seven new cities were measured at 4-35 MB and Viktor
chose to raise the caps rather than cut bounds or tile — "optimization
later". Six were raised again on 2026-09-10 for B14's 21 June window, and
ALL EIGHT were tightened on 2026-09-11 when the modelled day became 15
September: 49-50 buckets instead of 58-67 is roughly a quarter less shade,
and every city came in below its June figure.

The rule for a cap is one rule now: the smallest whole MiB at least 2 MiB
above the measured brotli sum, with an export run against it before the
number is committed. It still catches a regression and it is still a record
of debt rather than a target. Mind the units: the measurements below are
decimal MB and the caps are MiB, so "measured 14.90, budget 17" is 2.79 MiB
of headroom rather than 2.10, and both units are written out per city for
that reason (P1 review F7). Headroom on 2026-09-11, in MiB: frankfurt
2.15, berlin 2.00, hamburg 2.79, munich 2.70, paris 2.06, london 2.21,
nyc 2.67, sf 2.27.

A cap is a CITY's number and does not follow the season by itself: when
10_sun_shade's MODEL_DATE moves, every city has to be re-measured and every
cap re-set, in whichever direction the window went.

"bands" is how many shade files 08_export_graph wrote for that window, the
twin of `bands` in web/src/cities.ts (rule 2) — the client fetches the bands
BY that number, so a stale one is a 404 on a city's last band.
check_registry_bands holds an export to it, and prints it as an instruction
when a city has none yet.

CRS is the working projection, and it is not uniform even within Germany:
Berlin sits east of 12 E and belongs to UTM 33N, everything else German to
32N. Paris uses Lambert-93, London OSGB, New York State Plane Long Island,
San Francisco UTM 10N. Getting this wrong does not error, it silently
misplaces every metre-based cost.
"""

CITIES = {
    "frankfurt": {
        "place": "Frankfurt am Main, Germany",
        "crs": "EPSG:25832",
        "tz": "Europe/Berlin",
        "center": (8.6821, 50.1109),
        "bounds": (8.44, 50.01, 8.90, 50.24),  # = web/src/cities.ts, the map maxBounds
        "noise_year": 2022,  # 03_fetch_noise.py, Lärmkartierung Hessen 2022
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 8,  # measured 6.14 MB = 5.86 MiB on the 15 September window, 2026-09-11 (7.22 = 6.88 MiB in June)
    },
    "berlin": {
        "place": "Berlin, Germany",
        "crs": "EPSG:25833",
        "tz": "Europe/Berlin",
        "center": (13.405, 52.52),
        "bounds": (13.09, 52.34, 13.76, 52.68),  # = web/src/cities.ts, the map maxBounds
        "shade_year": 2021,  # manifests/dsm/README.md, "flown 2021"
        "noise_year": 2022,  # 03b_fetch_noise_wms.py, ua_stratlaerm_2022
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 31,  # measured 30.41 MB = 29.00 MiB on the 15 September window, 2026-09-11 (36.93 = 35.22 MiB in June)
    },
    "hamburg": {
        "place": "Hamburg, Germany",
        "crs": "EPSG:25832",
        "tz": "Europe/Berlin",
        "center": (9.9937, 53.5511),
        "bounds": (9.73, 53.39, 10.32, 53.74),  # = web/src/cities.ts, the map maxBounds
        "shade_year": 2020,  # manifests/dsm/README.md, "spring 2020"
        "noise_year": 2012,  # manifests/noise/README.md, the 2012 round
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 17,  # measured 14.90 MB = 14.21 MiB on the 15 September window, 2026-09-11 (17.21 = 16.42 MiB in June)
    },
    "munich": {
        "place": "Munich, Bavaria, Germany",
        "crs": "EPSG:25832",
        "tz": "Europe/Berlin",
        "center": (11.582, 48.1351),
        "bounds": (11.36, 48.06, 11.72, 48.25),  # = web/src/cities.ts, the map maxBounds
        "noise_year": 2022,  # 03b_fetch_noise_wms.py, aggroadlden2022
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 15,  # measured 12.90 MB = 12.30 MiB on the 15 September window, 2026-09-11 (14.90 = 14.21 MiB in June)
    },
    "paris": {
        "place": "Paris, France",
        "crs": "EPSG:2154",
        "tz": "Europe/Paris",
        "center": (2.3522, 48.8566),
        "bounds": (2.22, 48.81, 2.47, 48.91),  # = web/src/cities.ts, the map maxBounds
        "shade_year": 2023,  # manifests/dsm/README.md, "flown March 2023"
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 16,  # measured 14.62 MB = 13.94 MiB on the 15 September window, 2026-09-11 (17.80 = 16.97 MiB in June)
    },
    "london": {
        "place": "London, England, United Kingdom",
        # Greater London's 1.88 M-edge graph (35 MB brotli, 18k DSM tiles)
        # was too slow to use (Viktor, 2026-09-02). "clip" restricts the
        # graph and every place-scoped fetch to the union of these named
        # areas: the ONS "Inner London" boroughs, 3.7 M of the 9 M people on
        # a quarter of the area. Geocoded via Nominatim (common.place_polygon).
        "clip": [
            "City of London", "City of Westminster",
            "London Borough of Camden", "London Borough of Hackney",
            "London Borough of Hammersmith and Fulham", "London Borough of Haringey",
            "London Borough of Islington", "Royal Borough of Kensington and Chelsea",
            "London Borough of Lambeth", "London Borough of Lewisham",
            "London Borough of Newham", "London Borough of Southwark",
            "London Borough of Tower Hamlets", "London Borough of Wandsworth",
        ],
        "crs": "EPSG:27700",
        "tz": "Europe/London",
        "center": (-0.1276, 51.5072),
        "bounds": (-0.28, 51.40, 0.12, 51.62),  # = web/src/cities.ts, the map maxBounds
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 18,  # measured 16.56 MB = 15.79 MiB as Inner London on the 15 September window, 2026-09-11 (18.83 = 17.96 MiB in June)
    },
    "nyc": {
        "place": "New York City, New York, USA",
        # UTM 18N, not the usual NYC State Plane EPSG:2263: 2263's units are
        # US SURVEY FEET, so every edge length, every metre-based cost and
        # every distance in the router would be 3.28x out. Caught by
        # comparing median edge length against SF (2026-08-31): NYC read 40.6
        # where SF read 13.8, and 40.6 ft is 12.4 m. The DSM's heights are in
        # feet too and are scaled on ingest.
        "crs": "EPSG:26918",
        "tz": "America/New_York",
        "center": (-73.9857, 40.7484),
        "bounds": (-74.26, 40.49, -73.70, 40.92),  # = web/src/cities.ts, the map maxBounds
        "shade_year": 2017,  # manifests/dsm/README.md, "flown 3-17 May 2017"
        "noise_year": 2022,  # prep_noise_db.py, CONUS_road_noise_2022
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 29,  # measured 27.61 MB = 26.33 MiB on the 15 September window, 2026-09-11 (30.85 = 29.42 MiB in June)
    },
    "sf": {
        "place": "San Francisco, California, USA",
        "crs": "EPSG:26910",
        "tz": "America/Los_Angeles",
        "center": (-122.4194, 37.7749),
        "bounds": (-122.53, 37.70, -122.34, 37.84),  # = web/src/cities.ts, the map maxBounds
        "shade_year": 2024,  # prep_dsm.py, the CA_SanFrancisco_B23 survey
        "noise_year": 2022,  # prep_noise_db.py, CONUS_road_noise_2022
        "bands": 7,  # 08_export_graph, the 15 September window
        "budget_mib": 7,  # measured 4.96 MB = 4.73 MiB on the 15 September window, 2026-09-11 (5.43 = 5.18 MiB in June)
    },
}

# Rough count of admin_level 10 districts, for 01_build_graph's sanity check
# only — they feed the coverage report, never routing. Munich has 105
# Stadtbezirksteile against Frankfurt's 46 Stadtteile, London 33 boroughs,
# so a single hardcoded range cannot work (2026-08-30).
#
# 0 means "do not assert". Measured 2026-08-30, not guessed: berlin 109
# (expected ~96), hamburg 116 (~104), paris 98 (~80), all inside tolerance;
# nyc returns 15 of something that is not its 59 community districts, and
# san francisco has nothing at that level. London has 85 admin_level 10
# relations across Greater London, but osmnx's features_from_place for it
# fails with an HTTP error on every mirror tried — the graph is unaffected,
# so it is left unasserted rather than chased further.
DISTRICTS = {
    "frankfurt": 46, "berlin": 96, "hamburg": 104, "munich": 105,
    "paris": 80, "london": 0, "nyc": 0, "sf": 0,
}

DEFAULT = "frankfurt"
