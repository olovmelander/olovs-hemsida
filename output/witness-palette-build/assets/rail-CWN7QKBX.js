const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/map-hJFfJ_dO.js","assets/rolldown-runtime-hePW80VL.js","assets/icons-D34DfW1X.js","assets/map-vh-t_kPv.css"])))=>i.map(i=>d[i]);
import{t as e}from"./course-previews-z2p367Gd.js";import{t}from"./preload-helper-Czpn1I53.js";import{t as n}from"./icons-D34DfW1X.js";var r={visby:{id:`kust`,label:`Kronholmen · Seaside`,iconName:`wave`},lidingo:{id:`skog`,label:`Lidingö · Parkbana`,iconName:`tree`},tortuna:{id:`skog`,label:`Västerås · Skog & Park`,iconName:`tree`},angso:{id:`kust`,label:`Mälaren · Halvö`,iconName:`wave`},norrfallsviken:{id:`kust`,label:`Höga Kusten · Seaside`,iconName:`wave`},puttom:{id:`skog`,label:`Örnsköldsvik · Skog & Sjö`,iconName:`tree`},upsala:{id:`skog`,label:`Uppsala · Parkbana`,iconName:`tree`},johannesberg:{id:`slott`,label:`Gottröra · Slottsmiljö`,iconName:`castle`},veckefjarden:{id:`kust`,label:`Örnsköldsvik · Ö-green`,iconName:`wave`},ribbingsfors:{id:`skog`,label:`Gullspång · Park & Hagmark`,iconName:`tree`},"upsala-mellanbanan":{id:`skog`,label:`Uppsala · Andra nio`,iconName:`tree`},"johannesberg-9":{id:`slott`,label:`Gottröra · Andra nio`,iconName:`castle`},"veckefjarden-korthalsbanan":{id:`kust`,label:`Örnsköldsvik · Korthål`,iconName:`wave`}},i={tortuna:`Skogsslinga och parkhål vid Tortuna nordost om Västerås, ritad av Bengt Husell och spelklar 1991: en stor damm delar fyran och sexan, och Lillån slingrar genom de nio parkhålen.`,lidingo:`Sveriges första 18-hålsbana, spelklar 1927 på Sticklinge: en kuperad parkbana bland villor och skogsdungar, ombyggd av Peter Chamberlain 2006–2009 med hårda, ondulerade greener.`,veckefjarden:`Mästerskapsbanan vid fjärden, känd för sin ikoniska ö-green och utmanande vattenhinder.`,norrfallsviken:`Dramatisk skogs- och linkskaraktär på Mjällomlandet med klippor direkt mot Bottenhavet.`,puttom:`Naturskön skogs- och parkbana som slingrar sig elegant mellan två glittrande sjöar.`,angso:`Mälarnära bana på halvön norr om Ängsön med fem tees, mäktiga ekar och strategisk bunkring.`,upsala:`Klassisk svensk mästerskapsparkbana på historiska Håmö gårds böljande marker väster om Uppsala.`,johannesberg:`Slottsbana i rofylld herrgårdsmiljö med dammar, månghundraåriga ekar och ståtligt klubbhus.`,ribbingsfors:`Niohåls park- och hagmarksbana i herrgårdsmiljö vid sjön Skagern, ritad av Janne Lundvall och spelklar 1991.`,"upsala-mellanbanan":`Upsala GK:s andra nio, där åttans tee blickar ut över stora banan och fyrans green ligger tjugo meter från dammen.`,"johannesberg-9":`Johannesbergs andra nio, med en damm tvärs igenom och ett andrahål som faller drygt tolv meter ner mot vattnet.`,"veckefjarden-korthalsbanan":`Veckefjärdens korthålsbana: nio korta hål i tallskogen, med fjärden i sikte från tredje tee.`,visby:`Seaside med linkskaraktär på Kronholmen vid Västergarn, spelad sedan 1958 och rankad som Sveriges bästa bana av Svensk Golf 2020; Östersjön ligger några tiotal meter från de flesta greenerna, greenerna ombyggda av Pierre Fulke.`},a=e=>`${e} tees`;function o({courses:o,current:c,onPick:l,onIntent:u,isInitialBoot:d=!1}){o=[...o,...e.filter(e=>!o.some(t=>t.slug===e.slug))];let f=document.createElement(`div`);f.id=`chooser`,f.setAttribute(`role`,`dialog`),f.setAttribute(`aria-modal`,`true`),f.setAttribute(`aria-label`,`Välj bana`);let p=o.find(e=>e.slug===c),m=e=>o.filter(t=>(r[t.slug]||{}).id===e).length;f.innerHTML=`
    <div class="chooser-top-bar">
      <div class="chooser-brand">
        <div class="brand-crest">
          <span class="crest-dot"></span>
          <span class="wordmark">Ban<i>v</i>y</span>
        </div>
        <span class="hub-pill">3D Golf Experience</span>
      </div>

      <div class="chooser-top-actions">
        <div class="chooser-view-toggle" id="chooserViewToggle">
          <button class="c-view-btn active" data-view="grid" id="viewGridBtn" title="Visa som kort">
            ${n.gridCards(14)}
            <span>Kortvy</span>
          </button>
          <button class="c-view-btn" data-view="map" id="viewMapBtn" title="Visa på Sverigekarta">
            ${n.map(14)}
            <span>Sverigekarta</span>
          </button>
        </div>

        ${!d&&p?`
          <button class="chooser-resume-btn" id="chooserResumeBtn">
            <span>Återgå till ${s(p.name)}</span>
            ${n.close(14)}
          </button>
        `:``}
      </div>
    </div>

    <div class="chooser-head">
      <div class="chooser-title-wrap">
        <h1 class="chooser-main-title">Välj golfbana</h1>
        <p class="chooser-subtitle">Utforska ${o.filter(e=>e.status!==`mapping`).length} svenska golfbanor i 3D och följ nya banor under kartläggning.</p>
      </div>

      <div class="chooser-controls" id="chooserControls">
        <div class="chooser-search-box">
          ${n.search(16)}
          <input type="text" id="courseSearchInput" placeholder="Sök bana, stad eller par..." autocomplete="off" />
        </div>

        <div class="chooser-filters" id="chooserFilters">
          <button class="c-filter-btn active" data-filter="all">Alla banor (${o.length})</button>
          <button class="c-filter-btn" data-filter="kust">${n.wave(13)} Kust & Hav (${m(`kust`)})</button>
          <button class="c-filter-btn" data-filter="skog">${n.tree(13)} Skog & Park (${m(`skog`)})</button>
          <button class="c-filter-btn" data-filter="slott">${n.castle(13)} Slott & Herrgård (${m(`slott`)})</button>
        </div>
      </div>
    </div>

    <div class="chooser-scroll" id="chooserScroll">
      <!-- Grid Cards View -->
      <div id="cardsViewWrap" class="cards-view-wrap">
        <ul class="cards" id="coursesCardList">
          ${o.map(e=>{let t=r[e.slug]||{id:`all`,label:e.tag,iconName:`flag`},o=n[t.iconName]?n[t.iconName](13):n.flag(13),l=e.slug===c;return`
              <li class="card-item" data-slug="${e.slug}" data-category="${t.id}" data-search="${s(e.name+` `+e.club+` `+e.tag+` `+(i[e.slug]||``)).toLowerCase()}">
                <button class="card ${l?`is-current`:``}" type="button" data-slug="${e.slug}">
                  <div class="shot" data-slug="${e.slug}" data-photos="${e.photos||0}"
                       ${e.overviewUrl||e.photos?`style="background-image: url('/${e.overviewUrl||`courses/${e.slug}/hero-1.webp`}')"`:``}>
                    <span class="shot-frames" aria-hidden="true"></span>
                    <div class="shot-badges">
                      <span class="cat-badge">${o} <span>${s(t.label)}</span></span>
                      ${l?`<span class="current-badge">Aktiv bana</span>`:``}
                      ${e.status===`mapping`?`<span class="current-badge">Under kartläggning</span>`:``}
                      ${e.status===`provisional`?`<span class="current-badge">Preliminär 3D</span>`:``}
                    </div>
                    <div class="on-shot">
                      <p class="where">${s(e.club)}</p>
                      <h2>${s(e.name)}</h2>
                    </div>
                    <div class="shot-hover-action">
                      <span>${e.status===`mapping`?`Visa bankarta`:l?`Fortsätt spela`:`Starta bana`}</span>
                      <span class="sha-arrow">→</span>
                    </div>
                  </div>
                  <div class="body">
                    <p class="line">${s(e.description||i[e.slug]||e.club)}</p>
                    <div class="facts">
                      <div class="fact-item"><span class="f-lbl">Par</span> <b class="f-val">${e.par}</b></div>
                      <div class="fact-item"><span class="f-lbl">Hål</span> <b class="f-val">${e.holes}</b></div>
                      <div class="fact-item"><span class="f-lbl">Utslag</span> <b class="f-val">${a(e.tees.names.length)}</b></div>
                      <div class="fact-item fact-tag"><b>${e.status===`mapping`?`Bankarta`:`3D`}</b></div>
                    </div>
                  </div>
                </button>
              </li>
            `}).join(``)}
        </ul>
        <div id="noCoursesMsg" class="no-courses-msg" style="display:none;">
          <p>Inga banor matchar din sökning.</p>
          <button id="resetSearchBtn">Återställ sökning</button>
        </div>
      </div>

      <!-- Sweden Map View Wrap -->
      <div id="mapViewWrap" class="map-view-wrap" style="display: none;"></div>
    </div>
  `;let h=f.querySelector(`#courseSearchInput`),g=f.querySelectorAll(`.c-filter-btn`),_=f.querySelectorAll(`.card-item`),v=f.querySelector(`#noCoursesMsg`),y=f.querySelector(`#resetSearchBtn`),b=`all`,x=``;function S(){let e=0;_.forEach(t=>{let n=b===`all`||t.dataset.category===b,r=!x||t.dataset.search.includes(x);n&&r?(t.style.display=``,e++):t.style.display=`none`}),v.style.display=e===0?`block`:`none`}g.forEach(e=>{e.addEventListener(`click`,()=>{g.forEach(e=>e.classList.remove(`active`)),e.classList.add(`active`),b=e.dataset.filter,S()})}),h&&h.addEventListener(`input`,e=>{x=e.target.value.trim().toLowerCase(),S()}),y&&y.addEventListener(`click`,()=>{h&&(h.value=``),x=``,b=`all`,g.forEach(e=>e.classList.toggle(`active`,e.dataset.filter===`all`)),S()}),f.querySelectorAll(`.card`).forEach(e=>{if(e.addEventListener(`click`,()=>{let t=e.dataset.slug;l(t)}),u){let t=()=>u(e.dataset.slug);e.addEventListener(`pointerenter`,t,{once:!0}),e.addEventListener(`focus`,t,{once:!0})}});let C=window.matchMedia(`(prefers-reduced-motion: reduce)`).matches,w=5400,T=[];C||f.querySelectorAll(`.shot[data-photos]`).forEach((e,t)=>{let n=+e.dataset.photos||1;n<2||T.push({slug:e.dataset.slug,count:n,wrap:e.querySelector(`.shot-frames`),frames:[],idx:0,phase:t,nextAt:performance.now()+w+t*900,loaded:!1,visible:!1})});let E=window.requestIdleCallback||(e=>setTimeout(e,700)),D=e=>{if(e.loaded)return;e.loaded=!0;let t=n=>{if(n>e.count)return;let r=`/courses/${e.slug}/hero-${n}.webp`,i=new Image;i.onload=()=>{let i=document.createElement(`i`);i.style.backgroundImage=`url('${r}')`,e.wrap.append(i),e.frames.push(i),E(()=>t(n+1))},i.onerror=()=>{},i.src=r};E(()=>t(2))};if(T.length){let e=new IntersectionObserver(e=>{for(let t of e){let e=T.find(e=>e.wrap===t.target.querySelector(`.shot-frames`));e&&(e.visible=t.isIntersecting,t.isIntersecting&&D(e))}},{rootMargin:`200px`});f.querySelectorAll(`.shot[data-photos]`).forEach(t=>e.observe(t)),setInterval(()=>{let e=performance.now();if(f.hidden||document.hidden){for(let t of T)e>t.nextAt&&(t.nextAt=e+w+t.phase*900);return}for(let t of T)!t.visible||t.frames.length<1||e<t.nextAt||(t.nextAt=e+w,t.idx=(t.idx+1)%(t.frames.length+1),t.frames.forEach((e,n)=>e.classList.toggle(`is-on`,n===t.idx-1)))},400)}let O=f.querySelector(`#cardsViewWrap`),k=f.querySelector(`#mapViewWrap`),A=f.querySelector(`#viewGridBtn`),j=f.querySelector(`#viewMapBtn`),M=f.querySelector(`#chooserControls`),N=null;async function P(e){if(e===`map`){if(A.classList.remove(`active`),j.classList.add(`active`),O.style.display=`none`,k.style.display=`block`,M.style.display=`none`,!N){let{createSwedenMap:e}=await t(async()=>{let{createSwedenMap:e}=await import(`./map-hJFfJ_dO.js`);return{createSwedenMap:e}},__vite__mapDeps([0,1,2,3]));N=e({container:k,courses:o,current:c,onPickCourse:l})}N.invalidateSize()}else j.classList.remove(`active`),A.classList.add(`active`),k.style.display=`none`,O.style.display=`block`,M.style.display=`flex`}return A.addEventListener(`click`,()=>P(`grid`)),j.addEventListener(`click`,()=>P(`map`)),f}var s=e=>String(e||``).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e]);export{o as t};