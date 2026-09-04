/* ===========================================================================
   Banvy Sweden OpenStreetMap (OSM) Interactive Map
   Interactive dark luxury cartography of Sweden showing all golf courses,
   with pulsing emerald beacons, regional filters, and rich preview cards.
   =========================================================================== */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ICONS } from './icons.js';

export const COURSE_LOCATIONS = {
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
    lat: 59.8510,
    lng: 17.5250,
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
  veckefjarden: 'Mästerskapsbanan vid fjärden, känd för sin ikoniska ö-green och utmanande vattenhinder.',
  norrfallsviken: 'Dramatisk skogs- och linkskaraktär på Mjällomlandet med klippor direkt mot Bottenhavet.',
  puttom: 'Naturskön skogs- och parkbana som slingrar sig elegant mellan två glittrande sjöar.',
  angso: 'Mälarnära bana på halvön norr om Ängsön med fem tees, mäktiga ekar och strategisk bunkring.',
  upsala: 'Klassisk svensk mästerskapsparkbana på historiska Håmö gårds böljande marker väster om Uppsala.',
  johannesberg: 'Slottsbana i rofylld herrgårdsmiljö med dammar, månghundraåriga ekar och ståtligt klubbhus.',
  ribbingsfors: 'Niohåls park- och hagmarksbana i herrgårdsmiljö vid sjön Skagern, ritad av Janne Lundvall och spelklar 1991.',
};

const MAP_REGIONS = [
  { id: 'hogakusten', label: 'Höga Kusten', regions: ['Höga Kusten'] },
  { id: 'malardalen', label: 'Mälardalen & Uppland', regions: ['Mälardalen'] },
  { id: 'vastragotaland', label: 'Västra Götaland', regions: ['Västra Götaland'] },
];

export function createSwedenMap({ container, courses, current, onPickCourse }) {
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
        <button class="mpp-close-btn" id="mppCloseBtn">${ICONS.close(14)}</button>
        <div class="mpp-shot" style="background-image: url('${import.meta.env.BASE_URL}courses/${course.slug}/hero-1.webp')">
          <div class="mpp-badges">
            <span class="cat-badge">${iconSvg} <span>${esc(loc.regionTag)}</span></span>
            ${isCurrent ? '<span class="current-badge">Aktiv bana</span>' : ''}
          </div>
          <div class="mpp-shot-title">
            <div class="mpp-city">${esc(loc.city)}</div>
            <h3>${esc(course.name)}</h3>
          </div>
        </div>
        <div class="mpp-body">
          <p class="mpp-line">${esc(LINES[course.slug] || course.club)}</p>
          <div class="mpp-facts">
            <span>Par <b>${course.par}</b></span>
            <span><b>${course.holes}</b> hål</span>
            <span><b>${course.tees.names.length}</b> tees</span>
            <span class="mpp-tag">3D</span>
          </div>
          <button class="mpp-play-btn" id="mppPlayBtn">
            <span>${isCurrent ? 'Fortsätt spela' : 'Starta banan i 3D'}</span>
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

    marker.on('mouseover', () => {
      marker.getElement()?.classList.add('hovered');
    });

    marker.on('mouseout', () => {
      marker.getElement()?.classList.remove('hovered');
    });
  });

  // Region filtering and zoom buttons
  const regionBtns = controls.querySelectorAll('.mrb-btn');
  regionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      regionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const reg = btn.dataset.region;

      if (reg === 'sweden') {
        const bounds = L.latLngBounds(latLngs).pad(0.2);
        map.flyToBounds(bounds, { duration: 1 });
      } else {
        const region = MAP_REGIONS.find(item => item.id === reg);
        const points = region ? regionCourses(region).map(course => {
          const loc = COURSE_LOCATIONS[course.slug];
          return [loc.lat, loc.lng];
        }) : [];
        if (points.length === 1) map.flyTo(points[0], 9, { duration: 1 });
        else if (points.length > 1) map.flyToBounds(L.latLngBounds(points).pad(0.2), { duration: 1 });
      }
    });
  });

  // Fit initially to show all courses cleanly
  if (latLngs.length) {
    const bounds = L.latLngBounds(latLngs).pad(0.18);
    map.fitBounds(bounds);
  }

  // Show current or first course preview initially
  const initialCourse = courses.find(c => c.slug === current) || courses[0];
  if (initialCourse) {
    showPreview(initialCourse);
  }

  return {
    el: mapEl,
    map,
    invalidateSize: () => {
      setTimeout(() => {
        map.invalidateSize();
        if (latLngs.length) {
          const bounds = L.latLngBounds(latLngs).pad(0.18);
          map.fitBounds(bounds);
        }
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
