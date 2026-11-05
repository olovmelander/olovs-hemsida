/* Where each course lies: navigation markers for the Sweden map and for finding the
   course nearest a phone, never survey data. Kept apart from map.js, which imports
   Leaflet, so the chooser can read them without loading it. */
export const COURSE_LOCATIONS = {
  tortuna: {
    // Navigation marker from Tortuna's projected course frame, not a survey control.
    lat: 59.66075504228196, lng: 16.728689063923202, region: 'Mälardalen',
    regionTag: 'Västerås · Skog & Park', city: 'Västerås', iconName: 'tree',
  },
  visby: {
    // Club-linked Caddee main-course location; navigation marker only.
    lat: 57.441010, lng: 18.118760, region: 'Gotland',
    regionTag: 'Kronholmen · Seaside', city: 'Västergarn', iconName: 'wave',
  },
  lidingo: {
    lat: 59.37927, lng: 18.12738, region: 'Mälardalen',
    regionTag: 'Lidingö · Parkbana', city: 'Lidingö', iconName: 'tree',
  },
  angso: {
    lat: 59.5675,
    lng: 16.8684,
    region: 'Mälardalen',
    regionTag: 'Mälaren · Halvö',
    city: 'Västerås',
    iconName: 'wave',
  },
  johannesberg: {
    lat: 59.7390,
    lng: 18.1760,
    region: 'Mälardalen',
    regionTag: 'Gottröra · Slott',
    city: 'Gottröra',
    iconName: 'castle',
  },
  upsala: {
    // Model building w221193965, Upsala golfklubb; navigation marker only.
    lat: 59.8415076,
    lng: 17.4955179,
    region: 'Mälardalen',
    regionTag: 'Uppsala · Parkbana',
    city: 'Uppsala',
    iconName: 'tree',
  },
  norrfallsviken: {
    lat: 62.9640,
    lng: 18.2830,
    region: 'Höga Kusten',
    regionTag: 'Höga Kusten · Seaside',
    city: 'Mjällom',
    iconName: 'wave',
  },
  veckefjarden: {
    lat: 63.2670,
    lng: 18.7060,
    region: 'Höga Kusten',
    regionTag: 'Örnsköldsvik · Ö-green',
    city: 'Örnsköldsvik',
    iconName: 'wave',
  },
  puttom: {
    lat: 63.3410,
    lng: 18.7900,
    region: 'Höga Kusten',
    regionTag: 'Örnsköldsvik · Skog & Sjö',
    city: 'Arnäsvall',
    iconName: 'tree',
  },
  ribbingsfors: {
    lat: 58.9649569,
    lng: 14.1212497,
    region: 'Västra Götaland',
    regionTag: 'Gullspång · Herrgård',
    city: 'Gullspång',
    iconName: 'tree',
  },
};
