/* ===========================================================================
   Banvy Sweden OpenStreetMap (OSM) Interactive Map
   Interactive dark luxury cartography of Sweden showing all golf courses,
   with pulsing emerald beacons, regional filters, and rich preview cards.
   =========================================================================== */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ICONS } from './icons.js';

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

const LINES = {
  tortuna: '18 hål i Tortuna utanför Västerås, med dammar, parkmark och skog.',
  veckefjarden: 'Mästerskapsbanan vid fjärden, känd för sin ikoniska ö-green och utmanande vattenhinder.',
  norrfallsviken: 'Dramatisk skogs- och linkskaraktär på Mjällomlandet med klippor direkt mot Bottenhavet.',
  puttom: 'Naturskön skogs- och parkbana som slingrar sig elegant mellan två glittrande sjöar.',
  angso: 'Mälarnära bana på halvön norr om Ängsön med fem tees, mäktiga ekar och strategisk bunkring.',
  upsala: 'Klassisk svensk mästerskapsparkbana på historiska Håmö gårds böljande marker väster om Uppsala.',
  johannesberg: 'Slottsbana i rofylld herrgårdsmiljö med dammar, månghundraåriga ekar och ståtligt klubbhus.',
  ribbingsfors: 'Niohåls park- och hagmarksbana i herrgårdsmiljö vid sjön Skagern, ritad av Janne Lundvall och spelklar 1991.',
  'upsala-mellanbanan': 'Upsala GK:s andra nio, där åttans tee blickar ut över stora banan och fyrans green ligger tjugo meter från dammen.',
  'johannesberg-9': 'Johannesbergs andra nio, med en damm tvärs igenom och ett andrahål som faller drygt tolv meter ner mot vattnet.',
  'veckefjarden-korthalsbanan': 'Veckefjärdens korthålsbana: nio korta hål i tallskogen, med fjärden i sikte från tredje tee.',
  visby: 'Links på Kronholmen vid Västergarn där Östersjön ligger några tiotal meter från de flesta greenerna; ritad av Pierre Fulke och Adam Mednickson.',
};

const MAP_REGIONS = [
  { id: 'gotland', label: 'Gotland', regions: ['Gotland'] },
  { id: 'hogakusten', label: 'Höga Kusten', regions: ['Höga Kusten'] },
  { id: 'malardalen', label: 'Mälardalen & Uppland', regions: ['Mälardalen'] },
  { id: 'vastragotaland', label: 'Västra Götaland', regions: ['Västra Götaland'] },
];

export function createSwedenMap({ container, courses, current, lead = null, onPickCourse }) {
  const mapEl = document.createElement('div');
  mapEl.id = 'swedenMap';
  mapEl.className = 'sweden-map-container';

  // Map Controls Bar
  const controls = document.createElement('div');
  controls.className = 'map-region-bar';
  const mappedCourses = courses.filter(course => COURSE_LOCATIONS[course.slug]);
  const regionCourses = region => mappedCourses.filter(course =>
    region.regions.includes(COURSE_LOCATIONS[course.slug].region));
  controls.innerHTML = `
    <div class="mrb-label">Fokusera region:</div>
    <div class="mrb-btns">
      <button class="mrb-btn active" data-region="sweden">Hela Sverige (${mappedCourses.length})</button>
      ${MAP_REGIONS.map(region => {
        const count = regionCourses(region).length;
        return count ? `<button class="mrb-btn" data-region="${region.id}">${region.label} (${count})</button>` : '';
      }).join('')}
    </div>
  `;
  mapEl.append(controls);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'map-canvas-wrap';
  mapEl.append(canvasWrap);

  // Floating Course Preview Panel on map
  const previewPanel = document.createElement('div');
  previewPanel.className = 'map-preview-panel';
  previewPanel.id = 'mapPreviewPanel';
  mapEl.append(previewPanel);

  container.append(mapEl);

  // Initialize Leaflet Map
  // Sweden centered view
  const map = L.map(canvasWrap, {
    center: [61.4, 17.5],
    zoom: 6,
    minZoom: 5,
    maxZoom: 14,
    zoomControl: false,
    attributionControl: false,
  });

  /* OpenStreetMap's own tile servers. Fine while this is a handful of people
     looking at a handful of pins, but they are donated infrastructure and
     their usage policy rules out being the tile source for an app with real traffic --
     openstreetmap.org/copyright and operations.osmfoundation.org/policies/tiles.
     Before this goes anywhere public, point it at a provider (or a Cloudflare
     Worker caching one). The attribution below stays either way. */
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> bidragsgivare',
  }).addTo(map);

  const markers = {};
  const latLngs = [];

  function showPreview(course) {
    const loc = COURSE_LOCATIONS[course.slug] || { city: 'Sverige', regionTag: course.tag, iconName: 'flag' };
    const iconSvg = ICONS[loc.iconName] ? ICONS[loc.iconName](13) : ICONS.flag(13);
    const isCurrent = course.slug === current;

    previewPanel.innerHTML = `
      <div class="mpp-card">
        <button class="mpp-close-btn" id="mppCloseBtn" type="button" aria-label="Stäng förhandsvisningen">${ICONS.close(14)}</button>
        <div class="mpp-shot" ${course.photos || course.overviewUrl ? `style="background-image: url('${import.meta.env.BASE_URL}${course.photos ? `courses/${course.slug}/hero-1.webp` : course.overviewUrl}')"` : ''}>
          <div class="mpp-badges">
            <span class="cat-badge">${iconSvg}<span class="cat-text">${esc(loc.regionTag)}</span></span>
            ${isCurrent ? '<span class="current-badge">Aktiv bana</span>' : ''}
          </div>
        </div>
        <div class="mpp-titles">
          <div class="mpp-city">${esc(loc.city)}</div>
          <h3>${esc(course.name)}</h3>
        </div>
        <div class="mpp-body">
          <p class="mpp-line">${esc(course.description || LINES[course.slug] || course.club)}</p>
          <div class="mpp-facts">
            <span>Par <b>${course.par}</b></span>
            <span><b>${course.holes}</b> hål</span>
            <span><b>${course.tees.names.length}</b> tees</span>
            <span class="mpp-tag">${course.status === 'mapping' ? 'Under kartläggning' : '3D'}</span>
          </div>
          <button class="mpp-play-btn" id="mppPlayBtn">
            <span>${course.status === 'mapping' ? 'Visa bankarta' : isCurrent ? 'Fortsätt spela' : 'Starta banan i 3D'}</span>
            <span class="mpp-arrow">→</span>
          </button>
        </div>
      </div>
    `;

    previewPanel.classList.add('visible');

    previewPanel.querySelector('#mppCloseBtn').onclick = () => {
      previewPanel.classList.remove('visible');
    };

    previewPanel.querySelector('#mppPlayBtn').onclick = () => {
      onPickCourse(course.slug);
    };
  }

  // Create custom pulsing emerald pins for all courses
  courses.forEach(c => {
    const loc = COURSE_LOCATIONS[c.slug];
    if (!loc) return;

    latLngs.push([loc.lat, loc.lng]);
    const isCurrent = c.slug === current;
    const pinIconSvg = ICONS[loc.iconName] ? ICONS[loc.iconName](14) : ICONS.flag(14);

    const iconHtml = `
      <div class="golf-map-pin ${isCurrent ? 'is-current' : ''}">
        <div class="pin-pulse"></div>
        <div class="pin-head">
          <span class="pin-icon">${pinIconSvg}</span>
        </div>
        <div class="pin-label">
          <span class="pin-name">${esc(c.name)}</span>
          <span class="pin-sub">Par ${c.par}</span>
        </div>
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: 'golf-pin-container',
      iconSize: [120, 44],
      iconAnchor: [18, 18],
    });

    const marker = L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(map);
    markers[c.slug] = marker;

    marker.on('click', () => {
      map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 9), { duration: 0.8 });
      showPreview(c);
    });

    /* `hovered` belongs on the pin, which is what the stylesheet selects -- it
       was set on Leaflet's wrapper, where nothing looked for it. Lifted above
       its neighbours too, so a plate that comes back on hover is not drawn
       under the pins it was hidden to make room for. */
    const pinEl = () => marker.getElement()?.querySelector('.golf-map-pin');
    marker.on('mouseover', () => {
      pinEl()?.classList.add('hovered');
      marker.setZIndexOffset(1000);
    });

    marker.on('mouseout', () => {
      pinEl()?.classList.remove('hovered');
      marker.setZIndexOffset(0);
    });
  });

  /* Labels that would land on each other are not drawn. At the zoom that shows
     all of Sweden five clubs stand inside eighty pixels of Mälardalen and three
     at Örnsköldsvik, and their name plates used to pile into an unreadable
     stack -- over each other and over their neighbours' pins. A plate is kept
     only if it clears every pin head and every plate already kept; the running
     or last-opened course goes first so it is the one that survives a tie. The
     pins themselves always stay, and a hidden plate comes back on hover and as
     soon as the map is zoomed far enough for it to fit. */
  const labelOrder = [...new Set([current, lead, ...Object.keys(markers)])].filter(slug => markers[slug]);
  const overlaps = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  function declutter() {
    const pins = labelOrder.map(slug => markers[slug].getElement()?.querySelector('.golf-map-pin')).filter(Boolean);
    for (const pin of pins) pin.classList.remove('label-off');
    const heads = pins.map(pin => pin.querySelector('.pin-head').getBoundingClientRect());
    const kept = [];
    pins.forEach((pin, i) => {
      const plate = pin.querySelector('.pin-label').getBoundingClientRect();
      const blocked = kept.some(k => overlaps(plate, k)) || heads.some((h, j) => j !== i && overlaps(plate, h));
      if (blocked) pin.classList.add('label-off'); else kept.push(plate);
    });
  }
  map.on('zoomend moveend', declutter);

  /* What a fit has to stay clear of. The region bar lies across the top of the
     map and, on a phone, the preview row across the bottom of it -- a fit to the
     bare bounds put Gotland under the preview and cut Puttom's name plate off
     at the right edge, where there is no room for a plate to the right of its
     pin. Read at the moment of the fit, so a rotation is a different answer. */
  const fitPadding = () => (window.matchMedia('(max-width: 600px)').matches
    ? { paddingTopLeft: [16, 96], paddingBottomRight: [112, 164] }
    : { paddingTopLeft: [24, 90], paddingBottomRight: [140, 30] });

  // Region filtering and zoom buttons
  const regionBtns = controls.querySelectorAll('.mrb-btn');
  regionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      regionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const reg = btn.dataset.region;

      if (reg === 'sweden') {
        map.flyToBounds(L.latLngBounds(latLngs), { duration: 1, ...fitPadding() });
      } else {
        const region = MAP_REGIONS.find(item => item.id === reg);
        const points = region ? regionCourses(region).map(course => {
          const loc = COURSE_LOCATIONS[course.slug];
          return [loc.lat, loc.lng];
        }) : [];
        if (points.length === 1) map.flyTo(points[0], 9, { duration: 1 });
        else if (points.length > 1) map.flyToBounds(L.latLngBounds(points), { duration: 1, ...fitPadding() });
      }
    });
  });

  // Fit initially to show all courses cleanly
  if (latLngs.length) map.fitBounds(L.latLngBounds(latLngs), fitPadding());

  /* Open on the course the visitor has a reason to see: the running one, or the
     last one they opened. Without either, a wide screen shows the first course
     as a hint that pins open something; a phone shows the MAP, because there a
     preview nobody asked for is a panel over the pins they came to look at. */
  const narrow = window.matchMedia('(max-width: 600px)').matches;
  const bySlug = slug => (slug ? courses.find(c => c.slug === slug) : null);
  const initialCourse = bySlug(current) || bySlug(lead) || (narrow ? null : courses[0]);
  if (initialCourse) {
    showPreview(initialCourse);
  }

  return {
    el: mapEl,
    map,
    invalidateSize: () => {
      setTimeout(() => {
        map.invalidateSize();
        if (latLngs.length) map.fitBounds(L.latLngBounds(latLngs), fitPadding());
        declutter();
      }, 100);
    },
    focusCourse: (slug) => {
      const loc = COURSE_LOCATIONS[slug];
      const course = courses.find(c => c.slug === slug);
      if (loc && course) {
        map.flyTo([loc.lat, loc.lng], 9.5, { duration: 0.8 });
        showPreview(course);
      }
    }
  };
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
