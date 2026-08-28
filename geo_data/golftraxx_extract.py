# Pull a club's GPS survey out of GolfTraxx.
#
# Every course in the GolfTraxx directory has an internal id shaped as its postal
# code plus a country code — e.g. Abbekås Golfklubb = 27456SW, Norrfällsvikens GK =
# 28931SW, Örnsköldsviks Golfklubb Puttom (Ovansjö 232, Arnäsvall 891 95) = 89195SW.
# Find a course's id in the country listing:
#   https://golftraxx.com/courses-by-state?state=SW&static=true   (paginated)
# each table row prints the name and the id in a <td>.
#
# The course-map page renders the survey inline as Google-Maps markers — no API, no
# auth. Fetch it with a browser User-Agent:
#   https://golftraxx.com/full-layout?coursename=<name>&zipcode=<id>&city=&state=SW&static=true
# and this script turns the inline initMarker(...) calls into the same five-points-
# per-hole FeatureCollection the other files in this directory use:
#   Tee Target, Green Center/Front/Back, and TheTipsTee Back Reach.
# Verified exact: re-extracting 28931SW reproduces norrfallsviken_clean.json to 0.000 m
# across all 90 points.
#
#   python3 golftraxx_extract.py <layout.html> <out_clean.json> <ClubName>
import json, re, sys

html = open(sys.argv[1], encoding='utf-8', errors='replace').read()
out_path = sys.argv[2]
club = sys.argv[3]

# The page emits, per hole, a run of initMarker('gc'|'gf'|'gb'|'tt', LatLng(lat,lng), ...,'<label>')
# then an extra marker labelled "Hole N TheTipsTee Back Reach".
marker_re = re.compile(
    r"var myLatlng = new google\.maps\.LatLng\(parseFloat\(([-\d.]+)\), parseFloat\(([-\d.]+)\)\);\s*"
    r"initMarker\('(gc|gf|gb|tt)', myLatlng, map, \w+, '([^']*)'\)")
tee_re = re.compile(
    r'labelInfo = "Hole (\d+) TheTipsTee Back Reach";\s*'
    r"myLatlng = new google\.maps\.LatLng\(parseFloat\(([-\d.]+)\), parseFloat\(([-\d.]+)\)\)")

holes = {}
# tt markers carry the hole number in their label; gc/gf/gb inherit the NEXT tt's hole.
pending = []            # gc/gf/gb seen since the last tt
for m in marker_re.finditer(html):
    lat, lng, kind, label = float(m.group(1)), float(m.group(2)), m.group(3), m.group(4).strip()
    if kind == 'tt':
        n = int(label)
        h = holes.setdefault(n, {})
        h['tt'] = (lat, lng)
        for k, la, lo in pending:
            h[k] = (la, lo)
        pending = []
    else:
        pending.append((kind, lat, lng))

for m in tee_re.finditer(html):
    n = int(m.group(1))
    holes.setdefault(n, {})['tee'] = (float(m.group(2)), float(m.group(3)))

name_map = {'gc': ('green', 'Green Center'), 'gf': ('green', 'Green Front'),
            'gb': ('green', 'Green Back'), 'tt': ('tee', 'Tee Target'),
            'tee': ('waypoint', 'TheTipsTee Back Reach')}
feats = []
for n in sorted(holes):
    h = holes[n]
    for key in ('tt', 'gc', 'gf', 'gb', 'tee'):
        if key not in h:
            print(f'  WARNING hole {n} missing {key}', file=sys.stderr)
            continue
        lat, lng = h[key]
        typ, nm = name_map[key]
        feats.append({'type': 'Feature',
                      'geometry': {'type': 'Point', 'coordinates': [lng, lat]},
                      'properties': {'hole': str(n), 'type': typ, 'name': nm}})
fc = {'type': 'FeatureCollection', 'club': club, 'features': feats}
json.dump(fc, open(out_path, 'w'), indent=2)
print(f'wrote {out_path}: {len(holes)} holes, {len(feats)} points')
