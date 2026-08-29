/* The course rail: Banvy's front door.

   It is an OVERLAY over a live course rather than a screen instead of one. That
   is a deliberate v1 choice and it buys two things: the engine's boot stays the
   straight line it has always been (the re-entrant loadCourse belongs to the
   persistent-renderer phase, not here), and the first thing a visitor sees is a
   real course rendering behind the choice rather than a still page. Picking a
   course navigates -- teardown by reload -- which is the honest v1 mechanism.

   Each card is a poster: a build-time still of that course's signature hole,
   its name, the one line that says what kind of golf it is, and the numbers a
   golfer actually scans. The stills are rendered by the shot harness, so they
   are pictures of the thing itself and cannot fall out of date with it.        */
import '../styles/shell.css';

/* One line per course, in the register the club would use about itself. These
   are editorial, not derived -- a par count cannot say "seaside links in the
   High Coast" -- and they live here rather than in the manifest because they
   are about how the app SPEAKS, which is the shell's business. */
const LINES = {
  veckefjarden: 'Mästerskapsbanan vid fjärden, med en ö-green som banan är känd för.',
  norrfallsviken: 'Skogsbana med linkskaraktär som ligger seaside, ytterst på Mjällomlandet.',
  puttom: 'Skogs- och parkbana som slingrar mellan två sjöar utanför Örnsköldsvik.',
  angso: 'Mälarnära bana på fastlandshalvön norr om Ängsön, med fem tee och tung bunkring.',
  upsala: 'Parkbana på Håmö gårds marker väster om Uppsala, sex tee från 62 till 42.',
  johannesberg: 'Slottsbana i Gottröra: vatten, ekar och ett avslutningshål vid klubbhuset.',
};

const TEE_WORD = n => `${n} tee`;

export function buildRail({ courses, current, onPick }) {
  const el = document.createElement('div');
  el.id = 'chooser';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Välj bana');

  const head = document.createElement('div');
  head.className = 'chooser-head';
  head.innerHTML = '<div class="wordmark">Ban<i>v</i>y</div>' +
    '<p>Sex svenska banor, mätta mot klubbarnas egna kort och byggda ur verklig terräng.</p>';
  el.append(head);

  const scroll = document.createElement('div');
  scroll.className = 'chooser-scroll';
  const list = document.createElement('ul');
  list.className = 'cards';

  for (const c of courses) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'card';
    b.type = 'button';
    b.dataset.slug = c.slug;
    if (c.slug === current) b.setAttribute('aria-current', 'true');
    b.innerHTML =
      `<div class="shot"><div class="on-shot">` +
        `<p class="where">${esc(c.tag)}</p><h2>${esc(c.name)}</h2></div></div>` +
      `<div class="body">` +
        `<p class="line">${esc(LINES[c.slug] || c.club)}</p>` +
        `<p class="facts"><span><b>Par ${c.par}</b></span>` +
        `<span>${c.holes} hål</span><span>${TEE_WORD(c.tees.names.length)}</span></p>` +
      `</div>`;
    /* the poster is set only once it has actually loaded, so a course whose
       still has not been rendered yet shows the gradient instead of a gap */
    const shot = b.querySelector('.shot');
    const img = new Image();
    img.onload = () => { shot.style.backgroundImage = `url(${img.src})`; };
    img.src = `/courses/${c.slug}/hero-1.png`;

    b.addEventListener('click', () => onPick(c.slug));
    li.append(b);
    list.append(li);
  }

  scroll.append(list);
  el.append(scroll);
  return el;
}

const esc = s => String(s).replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
