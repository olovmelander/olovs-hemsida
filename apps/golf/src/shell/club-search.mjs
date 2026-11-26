/* One search for the clubs, shared by the list (rail.js) and the start menu's
   lobby (home.js, lobby-model.mjs): the same words find the same layouts in both. */
import { layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';

/* Case and accents fold away: "angso" finds Ängsö, "hal" finds "hål". */
export const searchText = text => String(text ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/* `places` is search vocabulary only, never shown: the placeholder promises
   "bana, ort eller par", and a promise on the front door has to be kept. It
   used to search name, club, tag and blurb -- so "Västerås" did not find Ängsö
   and "72" found nothing at all. */
export const CATEGORIES = {
  visby: { id: 'kust', label: 'Kronholmen · Seaside', iconName: 'wave', places: 'Gotland Västergarn Visby' },
  lidingo: { id: 'skog', label: 'Lidingö · Parkbana', iconName: 'tree', places: 'Stockholm Sticklinge' },
  'bro-hof-stadium': { id: 'slott', label: 'Bro · Slott vid Mälaren', iconName: 'castle', places: 'Upplands-Bro Stockholm Kungsängen Mälaren' },
  'bro-hof-castle': { id: 'slott', label: 'Bro · Andra arton', iconName: 'castle', places: 'Upplands-Bro Stockholm Kungsängen Mälaren' },
  tjusta: { id: 'skog', label: 'Rosersberg · Gård & Äng', iconName: 'tree', places: 'Rosersberg Sigtuna Arlanda Märsta Upplands Väsby Stockholm Uppland' },
  tortuna: { id: 'skog', label: 'Västerås · Skog & Park', iconName: 'tree', places: 'Västmanland Mälardalen' },
  angso: { id: 'kust', label: 'Mälaren · Halvö', iconName: 'wave', places: 'Västerås Västmanland Mälardalen' },
  norrfallsviken: { id: 'kust', label: 'Höga Kusten · Seaside', iconName: 'wave', places: 'Mjällom Nordingrå Kramfors Ångermanland' },
  puttom: { id: 'skog', label: 'Örnsköldsvik · Skog & Sjö', iconName: 'tree', places: 'Arnäsvall Ångermanland Höga Kusten' },
  upsala: { id: 'skog', label: 'Uppsala · Parkbana', iconName: 'tree', places: 'Håmö Uppland' },
  johannesberg: { id: 'slott', label: 'Gottröra · Slottsmiljö', iconName: 'castle', places: 'Uppland Roslagen' },
  veckefjarden: { id: 'kust', label: 'Örnsköldsvik · Ö-green', iconName: 'wave', places: 'Ångermanland Höga Kusten' },
  ribbingsfors: { id: 'skog', label: 'Gullspång · Park & Hagmark', iconName: 'tree', places: 'Skagern Västra Götaland' },
  /* the second courses, categorised with the club they belong to */
  'upsala-mellanbanan': { id: 'skog', label: 'Uppsala · Andra nio', iconName: 'tree', places: 'Håmö Uppland' },
  'johannesberg-9': { id: 'slott', label: 'Gottröra · Andra nio', iconName: 'castle', places: 'Uppland Roslagen' },
  'veckefjarden-korthalsbanan': { id: 'kust', label: 'Örnsköldsvik · Korthål', iconName: 'wave', places: 'Ångermanland Höga Kusten' },
};

export const COURSE_LINES = {
  'bro-hof-stadium': 'Robert Trent Jones Jr:s mästerskapsbana vid Mälaren: breda fairways, stora vita bunkrar, ö-greenen på 17 och hemgång mot slottet.',
  'bro-hof-castle': 'Bro Hofs andra arton, också ritad av Robert Trent Jones Jr: sex par 3, sex par 4 och sex par 5 genom park och skog, med små bunkrar och stora sandmarker.',
  tjusta: 'Par 72 runt Tjusta Gård nära Arlanda: skogs- och ängspartier, åkerkanten längs elvan och trettonan och hemgång runt gårdsdammen mot klubbhuset i den röda ladan.',
  tortuna: 'Skogsslinga och parkhål vid Tortuna nordost om Västerås, ritad av Bengt Husell och spelklar 1991: en stor damm delar fyran och sexan, och Lillån slingrar genom de nio parkhålen.',
  lidingo: 'Sveriges första 18-hålsbana, spelklar 1927 på Sticklinge: en kuperad parkbana bland villor och skogsdungar, ombyggd av Peter Chamberlain 2006–2009 med hårda, ondulerade greener.',
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
  visby: 'Seaside med linkskaraktär på Kronholmen vid Västergarn, spelad sedan 1958 och rankad som Sveriges bästa bana av Svensk Golf 2020; Östersjön ligger några tiotal meter från de flesta greenerna, greenerna ombyggda av Pierre Fulke.',
};

/* What a layout is found by: its names, its club, its town and region words, its
   card (par and holes) and the line the course page tells about it. */
export function courseSearchKey(course) {
  const cat = CATEGORIES[course.slug] || {};
  return searchText([course.name, layoutLabel(course), course.club, course.tag,
    cat.label, cat.places, COURSE_LOCATIONS[course.slug]?.city, `par ${course.par}`, `${course.holes} hål`, COURSE_LINES[course.slug]].filter(Boolean).join(' '));
}

/* Every word must match one layout. A typed hole count or par refers to the
   scorecard, even when a course description mentions another hole. */
export function parseQuery(text) {
  const query = searchText(text);
  const holes = query.match(/\b(\d+)[\s-]*(?:hals?|holes?)\b/);
  const par = query.match(/\bpar\s*(\d+)\b/);
  let words = query;
  if (holes) words = words.replace(holes[0], ' ');
  if (par) words = words.replace(par[0], ' ');
  return { query, holes: holes ? Number(holes[1]) : null, par: par ? Number(par[1]) : null, terms: words.match(/[\p{L}\p{N}]+/gu) || [] };
}

export function layoutMatches(course, key, { holes = null, par = null, terms = [] } = {}) {
  return (holes === null || course.holes === holes) && (par === null || course.par === par)
    && terms.every(term => key.includes(term));
}
