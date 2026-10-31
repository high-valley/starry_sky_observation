#!/usr/bin/env python3
"""Build compact star / constellation data for the app from d3-celestial.

Usage:
    git clone --depth 1 --filter=blob:none --sparse https://github.com/ofrohn/d3-celestial
    (cd d3-celestial && git sparse-checkout set data)
    python3 tools/build_data.py d3-celestial/data

Outputs (all RA/Dec are J2000, degrees, RA in 0..360):
    data/stars.json          [[ra, dec, mag, bv], ...] sorted by magnitude
    data/constellations.json [{id, ja, en, ra, dec, lines: [[[ra,dec],...], ...]}, ...]
    data/starnames.json      [{ra, dec, mag, ja, en, con}, ...]  named bright stars
"""
import json
import os
import sys

MAG_LIMIT = 6.0        # naked-eye limit
NAME_MAG_LIMIT = 2.6   # label stars brighter than this


def ra360(lon):
    return round(lon + 360 if lon < 0 else lon, 4)


def main(src):
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

    stars_src = json.load(open(os.path.join(src, 'stars.6.json'), encoding='utf-8'))
    names_src = json.load(open(os.path.join(src, 'starnames.json'), encoding='utf-8'))
    cons_src = json.load(open(os.path.join(src, 'constellations.json'), encoding='utf-8'))
    lines_src = json.load(open(os.path.join(src, 'constellations.lines.json'), encoding='utf-8'))

    stars = []
    named = []
    for f in stars_src['features']:
        mag = f['properties']['mag']
        if mag > MAG_LIMIT:
            continue
        lon, dec = f['geometry']['coordinates']
        try:
            bv = round(float(f['properties'].get('bv') or 0.6), 2)
        except ValueError:
            bv = 0.6
        ra = ra360(lon)
        stars.append([ra, round(dec, 4), round(mag, 2), bv])
        n = names_src.get(str(f['id']))
        if n and n.get('name') and mag <= NAME_MAG_LIMIT:
            named.append({
                'ra': ra, 'dec': round(dec, 4), 'mag': round(mag, 2),
                'ja': n.get('ja') or n['name'], 'en': n['name'], 'con': n.get('c', ''),
            })
    stars.sort(key=lambda s: s[2])
    named.sort(key=lambda s: s['mag'])

    lines = {f['id']: f['geometry']['coordinates'] for f in lines_src['features']}
    cons = []
    for f in cons_src['features']:
        p = f['properties']
        cid = f['id']
        lon, dec = f['geometry']['coordinates']
        cons.append({
            'id': cid,
            'ja': p.get('ja') or p['name'],
            'en': p['name'],
            'rank': int(p.get('rank', 3)),
            'ra': ra360(lon), 'dec': round(dec, 3),
            'lines': [[[ra360(a), round(d, 4)] for a, d in seg] for seg in lines.get(cid, [])],
        })

    def dump(name, obj):
        path = os.path.join(out_dir, name)
        with open(path, 'w', encoding='utf-8') as fp:
            json.dump(obj, fp, ensure_ascii=False, separators=(',', ':'))
        print(f'{name}: {len(obj)} entries, {os.path.getsize(path)//1024} KB')

    dump('stars.json', stars)
    dump('constellations.json', cons)
    dump('starnames.json', named)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'd3-celestial/data')
