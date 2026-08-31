# Puttom — underlag för auktoritativa spelytor

Den nuvarande Puttom-vyn använder verifierade 1 m-terrain-tiles, men dess
fairways, greener, tees och bunkrar är fortfarande migrerade GPK1-vektorer.
De får användas för opt-in-previewen, inte som inmätt banunderlag.

## Vad vi behöver från banägaren eller mätkonsulten

Helst en fil i EPSG:3006 (SWEREF 99 TM), med höjder i RH 2000 om höjdvärden
ingår. GeoJSON, GeoPackage, Shape eller DWG/DXF går bra som råunderlag. Vi
normaliserar därefter underlaget till den granskade JSON-kontraktfil som
preflight-kommandot tar emot. Vi behöver även:

- fångst-/mätdatum och mätmetod;
- uppmätt horisontell noggrannhet;
- polygoner för green, fringe, fairway, tee, bunker, stig/hård yta och större
  naturliga ytor där de är spelrelevanta;
- stabilt objektnamn eller hålnummer för varje polygon;
- uttryckligt tillstånd att normalisera och distribuera härledda runtime-data;
- en kontaktperson som kan godkänna granskade gränser.

Ingen kursguide, OSM-data eller äldre satellitspår får ensamt uppgradera
ytornas status.

## Maskinell kontroll

När en granskad källa finns används:

```sh
pnpm course-v2:puttom-surface-preflight -- --source /sökväg/till/reviewed-puttom-surfaces.json --require-ready
```

Kommandot lämnar en JSON-rapport och stoppar aktivering tills följande håller:

1. den kanoniska EPSG:5845-originen är godkänd mot oberoende kontroller;
2. terrain-frontiern är bunden till exakt samma ram;
3. råkällans checksumma, datum, licens, uppmätta noggrannhet och mänskliga
   granskning är godkända;
4. polygonerna är slutna, topologiskt giltiga och ligger inom terrain-frontiern;
5. en riktig ground-manifestpublicering ersätter — aldrig blandar med — den
   preliminära migrationen.

Den nuvarande rapporten ska visa `ready: false`. Det är ett avsiktligt skydd,
inte ett fel i Puttom-previewen.
