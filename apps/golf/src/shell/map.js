/* Swedish club locations. Pins open the same selection used by the catalogue. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ICONS } from './icons.js';
import { COURSE_LOCATIONS } from './course-places.mjs';

export { COURSE_LOCATIONS };

const MAP_REGIONS = [
  { id: 'gotland', label: 'Gotland', regions: ['Gotland'] },
  { id: 'hogakusten', label: 'Höga Kusten', regions: ['Höga Kusten'] },
  { id: 'malardalen', label: 'Mälardalen & Uppland', regions: ['Mälardalen'] },
  { id: 'vastragotaland', label: 'Västra Götaland', regions: ['Västra Götaland'] },
];

export function createSwedenMap({ container, groups, current, lead = null, onPickClub }) {
  const mapEl = document.createElement('div');
  mapEl.id = 'swedenMap';
  mapEl.className = 'sweden-map-container';

  // Map Controls Bar
  const controls = document.createElement('div');
  controls.className = 'map-region-bar';
  const mapped = groups.filter(group => COURSE_LOCATIONS[group.cover.slug]);
  const regionClubs = region => mapped.filter(group => region.regions.includes(COURSE_LOCATIONS[group.cover.slug].region));
  controls.innerHTML = `
    <div class="mrb-label">Fokusera region:</div>
    <div class="mrb-btns">
      <button class="mrb-btn active" data-region="sweden">Hela Sverige (${mapped.length})</button>
      ${MAP_REGIONS.map(region => {
        const count = regionClubs(region).length;
        return count ? `<button class="mrb-btn" data-region="${region.id}">${region.label} (${count})</button>` : '';
      }).join('')}
    </div>
  `;
  mapEl.append(controls);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'map-canvas-wrap';
  mapEl.append(canvasWrap);

  container.append(mapEl);

  // Initialize Leaflet Map
  // Sweden centered view
  const map = L.map(canvasWrap, {
    center: [61.4, 17.5],
    zoom: 6,
    minZoom: 5,
    maxZoom: 14,
    zoomControl: false,
    attributionControl: true,
  });

  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Zooma in', zoomOutTitle: 'Zooma ut' }).addTo(map);

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

  for (const group of mapped) {
    const loc = COURSE_LOCATIONS[group.cover.slug];

    latLngs.push([loc.lat, loc.lng]);
    const isCurrent = group.id === current;
    const pinIconSvg = ICONS[loc.iconName] ? ICONS[loc.iconName](14) : ICONS.flag(14);

    const iconHtml = `
      <div data-club-id="${esc(group.id)}" class="golf-map-pin ${isCurrent ? 'is-current' : ''}">
        <div class="pin-pulse"></div>
        <div class="pin-head">
          <span class="pin-icon">${pinIconSvg}</span>
        </div>
        <div class="pin-label">
          <span class="pin-name">${esc(group.name)}</span>
          <span class="pin-sub">${group.courses.length} ${group.courses.length === 1 ? 'bana' : 'banor'}</span>
        </div>
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: 'golf-pin-container',
      iconSize: [120, 44],
      iconAnchor: [18, 18],
    });

    const marker = L.marker([loc.lat, loc.lng], { icon: customIcon, title: group.name, alt: group.name }).addTo(map);
    const markerButton = marker.getElement();
    markerButton.setAttribute('aria-label', group.name);
    markerButton.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onPickClub(group.id);
    });
    markers[group.id] = marker;
    marker.on('click', () => onPickClub(group.id));

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
  }

  /* Labels that would land on each other are not drawn. At the zoom that shows
     all of Sweden five clubs stand inside eighty pixels of Mälardalen and three
     at Örnsköldsvik, and their name plates used to pile into an unreadable
     stack -- over each other and over their neighbours' pins. A plate is kept
     only if it clears every pin head and every plate already kept; the running
     or last-opened course goes first so it is the one that survives a tie. The
     pins themselves always stay, and a hidden plate comes back on hover and as
     soon as the map is zoomed far enough for it to fit. */
  const labelOrder = [...new Set([current, lead, ...Object.keys(markers)])].filter(slug => markers[slug]);
  const overlaps = (a, b) => !(a.right + 3 < b.left || a.left > b.right + 3 || a.bottom + 3 < b.top || a.top > b.bottom + 3);
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
  map.on('zoomend moveend resize', () => requestAnimationFrame(declutter));
  document.fonts?.ready.then(declutter);

  // Leave room for the region controls and the marker labels on a narrow map.
  const fitPadding = () => (window.matchMedia('(max-width: 600px)').matches
    ? { paddingTopLeft: [16, 96], paddingBottomRight: [100, 30] }
    : { paddingTopLeft: [24, 90], paddingBottomRight: [140, 30] });

  // Region filtering and zoom buttons
  const regionBtns = controls.querySelectorAll('.mrb-btn');
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const move = { duration: 0.6, animate: motion };
  regionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      regionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const reg = btn.dataset.region;

      if (reg === 'sweden') {
        map.flyToBounds(L.latLngBounds(latLngs), { ...move, ...fitPadding() });
      } else {
        const region = MAP_REGIONS.find(item => item.id === reg);
        const points = region ? regionClubs(region).map(group => {
          const loc = COURSE_LOCATIONS[group.cover.slug];
          return [loc.lat, loc.lng];
        }) : [];
        if (points.length === 1) map.flyTo(points[0], 9, move);
        else if (points.length > 1) map.flyToBounds(L.latLngBounds(points), { ...move, ...fitPadding() });
      }
    });
  });

  // Fit initially to show all courses cleanly
  if (latLngs.length) map.fitBounds(L.latLngBounds(latLngs), fitPadding());

  return {
    el: mapEl,
    map,
    invalidateSize: () => requestAnimationFrame(() => { map.invalidateSize({ pan: false }); declutter(); }),
    snapshot: () => {
      const { lat, lng } = map.getCenter();
      return { lat, lng, zoom: map.getZoom(), region: controls.querySelector('.active')?.dataset.region };
    },
    restore: ({ lat, lng, zoom, region }) => {
      if (![lat, lng, zoom].every(Number.isFinite)) return;
      map.setView([lat, lng], zoom, { animate: false });
      regionBtns.forEach(b => b.classList.toggle('active', b.dataset.region === region));
    },
    focusClub: (id, center = false) => {
      const marker = markers[id];
      if (!marker) return;
      if (center) map.setView(marker.getLatLng(), 9);
      marker.getElement()?.focus({ preventScroll: true });
    },
  };
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
