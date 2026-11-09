/* The play mode's screen, laid out as a golf broadcast and drawn in the
   detailed course's own language (its glass, its small spaced capitals for
   labels, JetBrains Mono for every number, turf green, amber and water blue).

   - Top left, the scorebug: the hole, its par, length and index, its name from
     the course guide (it opens the guide), the stroke and the round so far.
     Under it the distance panel: the pin, how it plays, the green's back,
     middle and front (the rangefinder's ladder), a target and the hazards.
   - Top right, the buttons, the conditions card (a wind dial turned to the aim,
     the lie % with its bar and the slope, the weather and the ground) and the
     hole map.
   - Bottom left the club and the shot's setup; bottom right the swing; between
     them, after a shot, its numbers as one strip.
   - The flyover and the replays are letterboxed, with a lower third.

   The detailed course's own panels step aside while a game is on (body.pl-on). */

const HIDDEN = ['#courseNav', '#menuToggle', '#card', '#railBackdrop', '#rail', '#leftStack', '#kikGreen', '#kikOut',
  '#note', '#holesContainer', '#mini', '#hint', '#mobileHudBar', '#uiToggle', '#cleanExit', '#tourCard', '#kikTag',
  '#gpsStatus', '#v2TerrainBadge', '#navDrawer'];

const CSS = `
body.pl-on ${HIDDEN.join(',body.pl-on ')},body.pl-on .hole-marker{display:none!important}
body.pl-on canvas{touch-action:none}
.pl-hud{--ink:#eef5ef;--dim:#a3b8ab;--faint:#71897c;--turf:#5fd07a;--turf-hi:#8ef0a4;--amber:#f0a23a;--water:#4bb4d8;--sand:#e2cf9a;
  --edge:rgba(160,230,185,.15);--ease:cubic-bezier(.16,1,.3,1);--gap:max(14px,env(safe-area-inset-left));
  position:fixed;inset:0;z-index:40;pointer-events:none;font-family:Outfit,ui-sans-serif,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.pl-hud>*{pointer-events:auto}
.pl-hud [hidden]{display:none!important}
.pl-glass{background:linear-gradient(180deg,rgba(20,38,29,.82),rgba(8,17,12,.84));backdrop-filter:blur(18px) saturate(1.25);-webkit-backdrop-filter:blur(18px) saturate(1.25);
  border:1px solid var(--edge);border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.06)}
.pl-k{font:650 9.5px/1.1 Outfit,system-ui,sans-serif;letter-spacing:.15em;text-transform:uppercase;color:var(--faint)}
.pl-n{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-weight:600}
.pl-hud button{font-family:inherit}
.pl-hud :focus-visible{outline:2px solid var(--turf);outline-offset:2px}

/* -- the columns -- */
.pl-left{position:absolute;left:var(--gap);top:max(14px,env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-start;gap:10px;pointer-events:none}
.pl-right{position:absolute;right:max(14px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}
.pl-left>*,.pl-right>*{pointer-events:auto}

/* -- the scorebug -- */
.pl-bugwrap{position:relative}
.pl-bug{display:flex;align-items:stretch;padding:0;overflow:hidden;color:inherit;text-align:left;cursor:pointer;min-height:68px;transition:border-color .2s}
.pl-bug:hover{border-color:rgba(160,230,185,.32)}
.pl-bug[aria-expanded=true]{border-color:var(--turf)}
.pl-bug-hole{display:grid;place-content:center;justify-items:center;min-width:62px;padding:0 10px;background:linear-gradient(160deg,#6fe08a,#3fae5d);color:#07170d}
.pl-bug-hole small{font:750 9px/1 Outfit,sans-serif;letter-spacing:.18em;text-transform:uppercase;opacity:.75}
.pl-bug-hole b{font:700 30px/1 'JetBrains Mono',monospace;margin-top:2px}
.pl-bug-main{display:grid;align-content:center;gap:3px;padding:9px 14px 9px 13px;min-width:0}
.pl-bug-name{font-size:16px;font-weight:650;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.pl-bug-guide{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dim)}
.pl-bug-guide svg{width:13px;height:13px;flex:none}
.pl-dots{display:inline-flex;gap:3px;margin-left:4px}
.pl-dots i{width:6px;height:6px;border-radius:50%;background:var(--turf)}
.pl-bug-score{display:grid;place-content:center;justify-items:center;min-width:62px;padding:0 12px;border-left:1px solid var(--edge);background:rgba(0,0,0,.16)}
.pl-bug-score small{font:650 9px/1 Outfit,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.pl-bug-score b{font:700 24px/1.05 'JetBrains Mono',monospace}
.pl-bug-score em{font:600 11.5px/1 'JetBrains Mono',monospace;font-style:normal;color:var(--dim);margin-top:2px}
.pl-bug-score em.under{color:var(--turf-hi)}.pl-bug-score em.over{color:#ffb48a}

/* -- the course guide -- */
.pl-guide{position:absolute;left:0;top:calc(100% + 8px);width:min(400px,calc(100vw - 28px));padding:16px 18px 14px;z-index:3;animation:pl-rise .28s var(--ease)}
.pl-guide h3{margin:4px 0 2px;font-size:19px;font-weight:700}
.pl-guide .pl-guide-sub{margin:0 0 10px;font-size:12.5px;color:var(--dim)}
.pl-guide p{margin:0 0 10px;font-size:14.5px;line-height:1.55}
.pl-guide .pl-guide-from{font-size:11.5px;color:var(--faint);margin:0}
.pl-guide-close{position:absolute;right:8px;top:8px;width:34px;height:34px;border:0;border-radius:10px;background:rgba(255,255,255,.06);color:var(--dim);font-size:17px;cursor:pointer}

/* -- the distance panel -- */
.pl-dist{display:grid;grid-template-columns:auto auto;align-items:center;gap:6px 18px;padding:12px 16px 12px 16px;min-width:0}
.pl-dist-main{display:grid;gap:3px}
.pl-dist-big{font:700 38px/1 'JetBrains Mono',monospace;letter-spacing:-.02em}
.pl-dist-big small{font:600 14px/1 Outfit,sans-serif;color:var(--dim);margin-left:3px;letter-spacing:0}
.pl-dist-plays{font-size:13px;color:var(--dim)}
.pl-dist-plays b{color:var(--ink);font-family:'JetBrains Mono',monospace;font-weight:600}
.pl-ladder{display:grid;gap:3px;padding-left:16px;border-left:1px solid var(--edge)}
.pl-ladder span{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.pl-ladder i{font:650 9px/1 Outfit,sans-serif;font-style:normal;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.pl-ladder b{font:600 14px/1.15 'JetBrains Mono',monospace;color:var(--dim)}
.pl-ladder .mid i{color:var(--turf)}.pl-ladder .mid b{font-size:18px;color:var(--ink)}
.pl-dist-rows{grid-column:1/-1;display:grid;gap:6px}
.pl-dist-rows:empty{display:none}
.pl-row-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px}
.pl-row-item svg{width:15px;height:15px;flex:none}
.pl-row-item b{font-family:'JetBrains Mono',monospace;font-weight:600}
.pl-row-item.water{color:#bfe8f7}.pl-row-item.water svg{color:var(--water)}
.pl-row-item.sand{color:#f1e5c2}.pl-row-item.sand svg{color:var(--sand)}
.pl-row-item.target svg{color:var(--amber)}
.pl-row-item button{margin-left:auto;width:26px;height:26px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:var(--dim);cursor:pointer}

/* -- the buttons -- */
.pl-top{display:flex;gap:8px}
.pl-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:46px;min-height:46px;padding:0 14px;border-radius:14px;font:600 14px Outfit,system-ui,sans-serif;color:inherit;cursor:pointer;transition:border-color .2s,background .2s}
.pl-btn:hover{border-color:rgba(160,230,185,.34)}
.pl-btn svg{width:19px;height:19px;flex:none}
.pl-btn.pl-live-btn svg{color:var(--turf-hi)}

/* -- the conditions card -- */
.pl-cond{width:224px;padding:12px 14px 12px;display:grid;gap:8px}
.pl-wind{display:flex;align-items:center;gap:12px}
.pl-dial{width:58px;height:58px;flex:none;overflow:visible}
.pl-dial .ring{fill:rgba(0,0,0,.22);stroke:rgba(160,230,185,.22);stroke-width:1.2}
.pl-dial .tick{stroke:rgba(234,243,236,.35);stroke-width:1.4;stroke-linecap:round}
.pl-dial .aim{fill:var(--turf)}
.pl-dial .arrow{fill:var(--water);transform:rotate(var(--deg,0deg));transition:transform .5s var(--ease)}
.pl-dial .hub{fill:#0b1a13;stroke:var(--water);stroke-width:1.5}
.pl-wind.calm .arrow{opacity:.25}
.pl-wind-text{display:grid;gap:2px}
.pl-wind-text b{font:700 22px/1 'JetBrains Mono',monospace}
.pl-wind-text b small{font:600 11px Outfit,sans-serif;color:var(--dim);margin-left:3px}
.pl-wind-text>span{font-size:12.5px;color:var(--dim)}
.pl-cond-row{display:flex;align-items:baseline;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07);font-size:13.5px}
.pl-cond-row .pl-k{min-width:44px}
.pl-cond-row b{font-weight:650}
.pl-cond-row em{margin-left:auto;font:600 13px 'JetBrains Mono',monospace;font-style:normal}
.pl-cond-row em.warn{color:var(--amber)}
.pl-liebar{display:block;height:4px;margin:-2px 0 0 52px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
.pl-liebar i{display:block;height:100%;width:calc(var(--p,1) * 100%);border-radius:2px;background:linear-gradient(90deg,var(--amber),var(--turf));transition:width .4s var(--ease)}
.pl-cond-sub{margin:-3px 0 0 52px;font-size:11.5px;color:var(--dim)}
.pl-cond-sub:empty{display:none}

/* -- the hole map -- */
.pl-map-slot{display:flex;justify-content:flex-end}
.pl-map{position:relative;width:224px;height:300px;padding:0;overflow:hidden;border-radius:16px}
.pl-map.small{width:104px;height:150px}
.pl-map canvas{position:absolute;inset:0;width:100%;height:100%}
.pl-map-over{cursor:crosshair}
.pl-map.small .pl-map-over{cursor:zoom-in}
.pl-map-size{position:absolute;right:6px;top:6px;width:28px;height:28px;border:0;border-radius:9px;background:rgba(9,18,14,.66);color:#eaf3ec;cursor:pointer}
.pl-map-size::before{content:'–';font:700 15px/28px Outfit,system-ui,sans-serif}
.pl-map.small .pl-map-size::before{content:'+'}
.pl-map::after{content:'Hålkarta';position:absolute;left:10px;top:9px;font:650 9px/1 Outfit,sans-serif;letter-spacing:.15em;text-transform:uppercase;color:rgba(234,243,236,.75);text-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none}
.pl-map.small::after{display:none}

/* -- the dock: club and setup -- */
.pl-dock{position:absolute;left:var(--gap);bottom:max(16px,env(safe-area-inset-bottom));display:flex;align-items:stretch;gap:8px}
.pl-clubs{display:flex;align-items:stretch;padding:4px}
.pl-clubs button{width:44px;border:0;background:transparent;color:var(--dim);font-size:22px;cursor:pointer;border-radius:12px;transition:background .15s,color .15s}
.pl-clubs button:hover{background:rgba(255,255,255,.06);color:var(--ink)}
.pl-club{display:grid;align-content:center;justify-items:center;gap:2px;min-width:132px;padding:6px 6px}
.pl-club b{font-size:19px;font-weight:700;line-height:1.1}
.pl-club span.pl-n{font-size:12.5px;color:var(--dim);font-weight:500}
.pl-setup-btn{display:grid;align-content:center;justify-items:start;gap:3px;min-width:132px;padding:8px 16px;text-align:left;color:inherit;cursor:pointer}
.pl-setup-btn b{font-size:14.5px;white-space:nowrap}
.pl-setup-btn[aria-expanded=true]{border-color:var(--turf)}
.pl-setup-panel{position:absolute;left:0;bottom:calc(100% + 10px);width:min(480px,calc(100vw - 28px));padding:14px 16px;animation:pl-rise .25s var(--ease)}
.pl-setup-panel .pl-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}
.pl-setup-panel .pl-row>span{min-width:46px}
.pl-setup-panel .pl-seg{flex-wrap:wrap;justify-content:flex-end}
.pl-setup-panel .pl-seg button{min-width:52px;min-height:38px;padding:0 9px}
.pl-setup-panel .pl-row.off{opacity:.38;pointer-events:none}
.pl-keys{margin:10px 0 0;font-size:11.5px;color:var(--faint)}

/* -- the swing -- */
.pl-swing{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));display:grid;justify-items:center;gap:8px}
.pl-pad{position:relative;width:88px;height:214px;border-radius:44px;background:linear-gradient(180deg,rgba(20,38,29,.84),rgba(8,17,12,.86));border:1px solid var(--edge);touch-action:none;cursor:grab;overflow:hidden;backdrop-filter:blur(18px);box-shadow:0 12px 34px rgba(0,0,0,.28)}
.pl-swing.active .pl-pad{cursor:grabbing;border-color:var(--turf)}
.pl-pad-fill{position:absolute;left:0;right:0;top:0;height:calc(var(--p,0) * 82%);background:linear-gradient(var(--turf),#2f9a52);opacity:.85;transition:height .05s}
.pl-swing.over .pl-pad-fill{background:linear-gradient(var(--turf),var(--amber))}
.pl-mark{position:absolute;left:16px;right:16px;top:calc(var(--at) * 82%);height:1px;background:rgba(234,243,236,.28)}
.pl-mark.full{height:2px;background:rgba(234,243,236,.7)}
.pl-knob{position:absolute;left:50%;top:calc(6px + var(--p,0) * 82%);width:60px;height:60px;margin-left:-30px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#e4ebe2);box-shadow:0 4px 12px rgba(0,0,0,.38);transform:translateX(calc(var(--drift,0) * 22px))}
.pl-target{position:absolute;left:6px;right:6px;top:calc(6px + 30px + var(--target,0) * 82% - 1px);height:3px;border-radius:2px;background:var(--amber);display:none;box-shadow:0 0 8px rgba(240,162,58,.7)}
.pl-swing.has-target .pl-target{display:block}
.pl-meter-target{position:absolute;top:0;bottom:0;left:calc(10% + var(--target,0) * 82%);width:3px;margin-left:-1.5px;background:var(--amber);display:none}
.pl-swing.has-target .pl-meter-target{display:block}
.pl-line{position:absolute;left:12px;right:12px;top:36px;height:2px;background:var(--amber);opacity:0}
.pl-swing.active .pl-line{opacity:.9}
.pl-meter,.pl-tap{display:none}
.pl-swing[data-method=tap] .pl-pad{display:none}
.pl-swing[data-method=tap] .pl-meter{display:block;position:relative;width:min(360px,62vw);height:28px;border-radius:14px;background:linear-gradient(180deg,rgba(20,38,29,.84),rgba(8,17,12,.86));border:1px solid var(--edge);overflow:hidden}
.pl-meter-fill{position:absolute;left:10%;top:0;bottom:0;width:calc(var(--p,0) * 82%);background:linear-gradient(90deg,#2f9a52,var(--turf))}
.pl-meter-sweet{position:absolute;left:calc(10% - 3px);top:0;bottom:0;width:6px;background:var(--amber)}
.pl-meter-marker{position:absolute;top:-2px;bottom:-2px;left:calc(10% + var(--m,0) * 82%);width:4px;margin-left:-2px;background:#fff;border-radius:2px}
.pl-swing[data-method=tap] .pl-tap{display:block;min-width:150px;min-height:56px;border-radius:16px;border:0;background:linear-gradient(160deg,#6fe08a,#3fae5d);color:#07170d;font:700 18px Outfit,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.28)}
.pl-swing.off{opacity:.32;pointer-events:none}
.pl-swing-hint{font-size:11.5px;color:var(--dim);text-shadow:0 1px 3px rgba(0,0,0,.6)}
.pl-power{position:absolute;right:calc(max(18px,env(safe-area-inset-right)) + 104px);bottom:calc(max(18px,env(safe-area-inset-bottom)) + 150px);padding:8px 12px;border-radius:12px;font:600 15px 'JetBrains Mono',monospace;opacity:0;transform:translateX(6px);transition:opacity .2s,transform .2s var(--ease);pointer-events:none}
.pl-power.show{opacity:1;transform:none}
.pl-power.good{color:var(--turf-hi)}.pl-power.bad{color:var(--amber)}

/* -- the shot's numbers -- */
.pl-stats{position:absolute;left:calc(var(--gap) + 392px);right:calc(max(18px,env(safe-area-inset-right)) + 112px);bottom:max(30px,env(safe-area-inset-bottom));max-width:900px;margin:0 auto;padding:12px 16px 12px;opacity:0;pointer-events:none;transform:translateY(10px);transition:opacity .35s,transform .35s var(--ease)}
.pl-stats.show{opacity:1;transform:none;pointer-events:auto}
.pl-stats header{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}
.pl-stats header b{font-size:15.5px;font-weight:700}
.pl-stats header b.good{color:var(--turf-hi)}.pl-stats header b.bad{color:var(--amber)}
.pl-stats header span{font-size:12px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-stats dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px 0;margin:0}
.pl-stats dl>div{display:grid;gap:4px;padding:2px 10px;border-left:1px solid rgba(255,255,255,.07)}
.pl-stats dl>div:first-child{border-left:0;padding-left:0}
.pl-stats dt{font:650 9px/1 Outfit,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl-stats dd{margin:0;font:700 18px/1.1 'JetBrains Mono',monospace;white-space:nowrap}
.pl-stats dd small{font:600 11px Outfit,sans-serif;color:var(--dim);margin-left:2px}

/* -- the banner -- */
.pl-banner{position:absolute;left:50%;top:21%;transform:translate(-50%,-10px) scale(.97);min-width:240px;padding:14px 26px 14px;text-align:center;opacity:0;transition:opacity .35s,transform .45s var(--ease);pointer-events:none}
.pl-banner.show{opacity:1;transform:translate(-50%,0) scale(1)}
.pl-banner b{display:block;font-size:28px;font-weight:750;letter-spacing:-.01em}
.pl-banner span{display:block;margin-top:3px;font-size:14px;color:var(--dim)}
.pl-banner::after{content:'';display:block;width:42px;height:3px;margin:10px auto 0;border-radius:2px;background:rgba(234,243,236,.35)}
.pl-banner.good b{color:var(--turf-hi)}.pl-banner.good::after{background:var(--turf)}
.pl-banner.bad b{color:var(--amber)}.pl-banner.bad::after{background:var(--amber)}

/* -- cinema: the flyover and the replays -- */
.pl-bars{position:fixed;inset:0;z-index:39;pointer-events:none}
.pl-bars i{position:absolute;left:0;right:0;height:9vh;background:#020604;transition:transform .6s var(--ease)}
.pl-bars i:first-child{top:0;transform:translateY(-100%)}
.pl-bars i:last-child{bottom:0;transform:translateY(100%)}
body.pl-cinema .pl-bars i{transform:none}
body.pl-cinema .pl-left,body.pl-cinema .pl-right,body.pl-cinema .pl-dock,body.pl-cinema .pl-swing,body.pl-cinema .pl-help,body.pl-cinema .pl-power,body.pl-cinema .pl-stats{opacity:0;pointer-events:none;transition:opacity .3s}
.pl-left,.pl-right,.pl-dock,.pl-swing{transition:opacity .3s}
.pl-third{position:absolute;left:calc(var(--gap) + 2vw);bottom:calc(9vh + 26px);max-width:min(620px,calc(100vw - 48px));display:grid;gap:4px;padding:16px 22px 18px 20px;border-left:4px solid var(--turf);border-radius:4px 16px 16px 4px;opacity:0;transform:translateX(-16px);transition:opacity .45s,transform .55s var(--ease);pointer-events:none}
.pl-third.show{opacity:1;transform:none}
.pl-third-kicker{font:650 11px/1.2 Outfit,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--turf-hi)}
.pl-third b{font-size:30px;font-weight:750;line-height:1.1;letter-spacing:-.01em}
.pl-third-sub{font-size:14px;color:var(--dim)}
.pl-third p{margin:8px 0 0;font-size:15px;line-height:1.55;color:#dfe9e2}
.pl-third p:empty,.pl-third-sub:empty,.pl-third-kicker:empty{display:none}
.pl-live{position:absolute;left:50%;top:calc(9vh + 14px);transform:translateX(-50%);display:none;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:rgba(2,6,4,.72);font:700 11.5px/1 Outfit,sans-serif;letter-spacing:.16em;text-transform:uppercase}
.pl-live i{width:8px;height:8px;border-radius:50%;background:#ff5a4a;box-shadow:0 0 10px #ff5a4a;animation:pl-pulse 1.4s ease-in-out infinite}
.pl-live.show{display:inline-flex}
.pl-skip{position:absolute;right:calc(max(14px,env(safe-area-inset-right)) + 2vw);bottom:calc(9vh + 26px);display:none;font-size:12px;color:var(--dim);letter-spacing:.04em}
body.pl-cinema .pl-skip{display:block}
@keyframes pl-pulse{50%{opacity:.35}}
@keyframes pl-rise{from{opacity:0;transform:translateY(6px)}}

/* -- the clean view -- */
body.pl-clean .pl-hud>*:not(.pl-banner):not(.pl-clean-hint){visibility:hidden}
.pl-clean-hint{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:7px 14px;border-radius:999px;font-size:12px;color:var(--dim);display:none}
body.pl-clean .pl-clean-hint{display:block}

.pl-help{position:absolute;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);font-size:11.5px;color:rgba(234,243,236,.62);text-shadow:0 1px 3px rgba(0,0,0,.75);white-space:nowrap;pointer-events:none}
.pl-help kbd{font:600 10.5px 'JetBrains Mono',monospace;padding:1px 4px;border-radius:4px;background:rgba(0,0,0,.35);color:var(--ink)}
.pl-fade{position:fixed;inset:0;z-index:41;background:#0b1a13;opacity:0;pointer-events:none;transition:opacity .32s}
.pl-fade.on{opacity:1}

/* -- the sheets: the menu and a hole's card -- */
.pl-sheet{position:fixed;inset:0;z-index:42;display:none;place-items:center;background:radial-gradient(ellipse at center,rgba(5,12,9,.35),rgba(5,12,9,.62))}
.pl-sheet.open{display:grid;animation:pl-fadein .25s}
@keyframes pl-fadein{from{opacity:0}}
.pl-sheet-box{width:min(600px,calc(100vw - 28px));max-height:calc(100dvh - 40px);overflow:auto;padding:0;border-radius:22px;color:var(--ink);font-family:Outfit,system-ui,sans-serif;animation:pl-rise .3s var(--ease)}
.pl-sheet-box>section,.pl-sheet-box>.pl-pad-in{padding:20px 22px}
.pl-sheet h2{margin:0 0 2px;font-size:26px;font-weight:750}
.pl-sheet .pl-sub{color:var(--dim);margin:0 0 14px;font-size:13.5px}
.pl-hero{position:relative;padding:22px 22px 18px;border-bottom:1px solid var(--edge);background:radial-gradient(ellipse at 20% 0%,rgba(95,208,122,.18),transparent 65%)}
.pl-hero.bad{background:radial-gradient(ellipse at 20% 0%,rgba(240,162,58,.16),transparent 65%)}
.pl-hero h2{font-size:40px;letter-spacing:-.02em;margin:6px 0 4px}
.pl-hero.good h2{color:var(--turf-hi)}.pl-hero.bad h2{color:#ffc58f}
.pl-hero p{margin:0;color:var(--dim);font-size:14px}
.pl-hero p b{color:var(--ink)}
.pl-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 14px}
.pl-tile{padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.05)}
.pl-tile b{display:block;margin-top:5px;font:700 20px/1 'JetBrains Mono',monospace}
.pl-tile b small{font:600 11px Outfit,sans-serif;color:var(--dim)}
.pl-table{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:13px;margin:4px 0 12px}
.pl-table th,.pl-table td{padding:7px 3px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07)}
.pl-table th{color:var(--faint);font:650 10px Outfit,sans-serif;letter-spacing:.1em;text-transform:uppercase}
.pl-table tr:first-child th{color:var(--dim)}
.pl-table td.under{color:var(--turf-hi)}.pl-table td.under span{display:inline-grid;place-items:center;width:24px;height:24px;border:1.5px solid var(--turf);border-radius:50%}
.pl-table td.over{color:#ffc58f}.pl-table td.over span{display:inline-grid;place-items:center;width:24px;height:24px;border:1.5px solid rgba(240,162,58,.7);border-radius:4px}
.pl-table td.sum,.pl-table th.sum{background:rgba(255,255,255,.04);font-weight:700}
.pl-actions{display:flex;gap:10px;flex-wrap:wrap;padding:16px 22px 20px;border-top:1px solid var(--edge)}
.pl-actions .pl-btn{flex:1;min-height:50px}
.pl-primary{background:linear-gradient(160deg,#6fe08a,#3fae5d);color:#07170d;border:0;font-weight:700}
.pl-ghost{background:rgba(255,255,255,.04);border:1px solid var(--edge)}
.pl-tabs{display:flex;gap:4px;margin:14px 22px 0;padding:4px;border-radius:14px;background:rgba(0,0,0,.25)}
.pl-tabs button{flex:1;min-height:40px;border:0;border-radius:10px;background:transparent;color:var(--dim);font:650 13.5px Outfit,sans-serif;cursor:pointer}
.pl-tabs button[aria-selected=true]{background:rgba(95,208,122,.16);color:var(--ink);box-shadow:inset 0 0 0 1px rgba(95,208,122,.4)}
.pl-menu .pl-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0;font-size:14.5px}
.pl-seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:rgba(0,0,0,.28)}
.pl-seg button{min-height:40px;min-width:62px;border:0;border-radius:9px;background:transparent;color:var(--dim);font:600 13px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-seg button[aria-pressed=true]{background:var(--turf);color:#07170d}
.pl-lights{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin:4px 0 12px}
.pl-light{display:grid;justify-items:center;gap:6px;padding:8px 4px 7px;border:1px solid transparent;border-radius:13px;background:rgba(255,255,255,.04);color:var(--ink);font:550 12px Outfit,system-ui,sans-serif;cursor:pointer;transition:background .15s,border-color .15s}
.pl-light:hover{background:rgba(255,255,255,.08)}
.pl-light i{width:100%;max-width:62px;height:38px;border-radius:9px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.pl-light[aria-pressed=true]{border-color:var(--turf);background:rgba(95,208,122,.12)}
.pl-note{margin:0 0 6px;padding:11px 13px;border-radius:12px;background:rgba(255,255,255,.04);font-size:13px;line-height:1.5;color:var(--dim)}
.pl-stepper{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:12px;background:rgba(0,0,0,.28)}
.pl-stepper button{width:40px;height:40px;border:0;border-radius:9px;background:transparent;color:var(--ink);font:600 18px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-stepper output{min-width:42px;text-align:center;font:600 15px 'JetBrains Mono',monospace}

/* -- a phone -- */
@media (max-width:640px){
  .pl-hud{--gap:max(10px,env(safe-area-inset-left))}
  .pl-left{top:max(10px,env(safe-area-inset-top));gap:8px;max-width:calc(100vw - 140px)}
  .pl-right{top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));gap:8px}
  .pl-bug{min-height:56px;border-radius:14px}
  .pl-bug-hole{min-width:46px;padding:0 7px}
  .pl-bug-hole b{font-size:23px}
  .pl-bug-main{padding:7px 10px;gap:2px}
  .pl-bug-name{font-size:13.5px;max-width:none}
  .pl-bug-main .pl-k{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pl-bug-guide{display:none}
  .pl-bug-score{min-width:46px;padding:0 8px}
  .pl-bug-score b{font-size:19px}
  .pl-dist{padding:9px 12px;gap:6px 12px;border-radius:14px}
  .pl-dist-big{font-size:28px}
  .pl-dist-plays{font-size:12px}
  .pl-ladder{padding-left:12px}
  .pl-ladder b{font-size:12.5px}.pl-ladder .mid b{font-size:15px}
  .pl-row-item{font-size:12px;padding:6px 8px}
  .pl-top{gap:6px}
  .pl-top .pl-btn{padding:0 11px}
  .pl-top .pl-btn span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .pl-cond{width:120px;padding:9px 10px;gap:6px;border-radius:14px}
  .pl-wind{gap:8px}
  .pl-dial{width:38px;height:38px}
  .pl-wind-text b{font-size:16px}
  .pl-wind-text>span,.pl-cond-sub,.pl-cond-row .pl-k{display:none}
  .pl-idx{display:none}
  .pl-bugwrap{max-width:calc(100vw - 186px)}
  .pl-bug{max-width:100%}
  .pl-bug-main{min-width:0;flex:1}
  .pl-swing.off{opacity:0}
  .pl-stats header{flex-wrap:wrap;gap:2px 10px;margin-bottom:8px}
  .pl-stats header span{flex-basis:100%;font-size:11px}
  .pl-cond-row{padding-top:6px;font-size:12px}
  .pl-liebar{margin:-2px 0 0}
  .pl-map{width:120px;height:186px}
  .pl-map.small{width:120px;height:120px}
  .pl-map::after{display:none}
  .pl-guide{width:calc(100vw - 20px)}
  .pl-club{min-width:100px}
  .pl-club b{font-size:16.5px}
  .pl-clubs button{width:40px}
  .pl-setup-btn{min-width:0;padding:6px 11px}
  .pl-setup-btn b{font-size:13px}
  .pl-setup-panel .pl-seg button{min-width:44px;padding:0 7px;font-size:12px}
  .pl-pad{width:80px;height:184px}
  .pl-help{display:none}
  .pl-stats{left:max(10px,env(safe-area-inset-left));right:calc(max(14px,env(safe-area-inset-right)) + 92px);bottom:calc(max(16px,env(safe-area-inset-bottom)) + 86px);width:auto;max-width:none;min-width:0;transform:translateY(10px);padding:10px 12px}
  .pl-stats.show{transform:none}
  .pl-stats dl{grid-template-columns:repeat(3,1fr);row-gap:10px}
  .pl-stats dl>div{padding:2px 6px}
  .pl-stats dl>div:nth-child(3n+1){border-left:0;padding-left:0}
  .pl-actions .pl-primary{flex-basis:100%}
  .pl-stats dd{font-size:15px}
  .pl-swing[data-method=tap]{left:max(14px,env(safe-area-inset-left));right:max(14px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 74px)}
  .pl-swing[data-method=tap] .pl-meter,.pl-swing[data-method=tap] .pl-tap{width:100%}
  .pl-banner{top:30%;max-width:calc(100vw - 40px);padding:11px 18px}
  .pl-banner b{font-size:21px}
  .pl-banner span{font-size:12.5px}
  .pl-third{left:12px;right:12px;bottom:calc(9vh + 14px);padding:12px 14px 14px;max-width:none}
  .pl-third b{font-size:21px}
  .pl-third p{font-size:13.5px}
  .pl-skip{right:14px;bottom:calc(9vh - 26px);font-size:11px}
  .pl-power{right:calc(max(14px,env(safe-area-inset-right)) + 92px);bottom:calc(max(18px,env(safe-area-inset-bottom)) + 130px);font-size:13.5px}
  .pl-hero h2{font-size:32px}
  .pl-lights{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  .pl-light{font-size:11px;padding:6px 2px 5px}
  .pl-light i{height:26px}
  .pl-sheet-box>section,.pl-sheet-box>.pl-pad-in{padding:16px}
  .pl-actions{padding:14px 16px 16px}
  .pl-tabs{margin:12px 16px 0}
}
@media (max-width:1180px) and (min-width:641px){
  .pl-stats{left:var(--gap);right:calc(max(18px,env(safe-area-inset-right)) + 112px);bottom:calc(max(16px,env(safe-area-inset-bottom)) + 92px)}
}
@media (max-height:720px) and (min-width:641px){
  .pl-map{width:200px;height:238px}
  .pl-dist-big{font-size:32px}
}
@media (prefers-reduced-motion:reduce){
  .pl-banner,.pl-fade,.pl-dial .arrow,.pl-bars i,.pl-third,.pl-stats,.pl-power,.pl-liebar i{transition:none}
  .pl-live i{animation:none}
  .pl-guide,.pl-setup-panel,.pl-sheet.open,.pl-sheet-box{animation:none}
}
`;

const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = {
  replay: svg('M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5'),
  camera: svg('M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7'),
  menu: svg('M4 7h16M4 12h16M4 17h16'),
  book: svg('M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5'),
  target: svg('M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'),
  water: svg('M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2.5-1.5 4.5-1.5S19 15 21 15M3 19.5c2 0 2-1.5 4.5-1.5S9.5 19.5 12 19.5s2.5-1.5 4.5-1.5S19 19.5 21 19.5M12 3l3.5 5.5a4 4 0 1 1-7 0z'),
  sand: svg('M3 17c3-4 6-5 9-5s6 1 9 5M3 21h18M8 9l1-2M12 8V5M16 9l-1-2'),
};
/** A number and its unit, the unit set smaller: '203 m' -> 203<small>m</small>. */
const figure = value => {
  const m = /^([−\-+]?[\d\s.,:]+)\s*(.*)$/.exec(String(value));
  return m ? `${esc(m[1].trim())}${m[2] ? `<small>${esc(m[2])}</small>` : ''}` : esc(value);
};
const metres = d => (d < 10 ? d.toFixed(1).replace('.', ',') : String(Math.round(d)));

/* The wind dial: the aim is up (the turf mark), the arrow is where the wind blows. */
const DIAL = `<svg class="pl-dial" viewBox="-32 -32 64 64" aria-hidden="true">
  <circle class="ring" r="28"/>
  ${Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, r0 = i % 3 ? 24.5 : 22.5; return `<line class="tick" x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * 27).toFixed(2)}" y2="${(-Math.cos(a) * 27).toFixed(2)}"/>`; }).join('')}
  <path class="aim" d="M0 -31 L3.5 -25 L-3.5 -25 Z"/>
  <path class="arrow" d="M0 -19 L7 -5 L2.2 -7 L2.2 16 L-2.2 16 L-2.2 -7 L-7 -5 Z"/>
  <circle class="hub" r="3.2"/>
</svg>`;

export function createPlayHud({ onMenu, onClub, onView, onSetup, onSetupToggle, onReplay, onGuide, onClearTarget }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const bars = document.createElement('div'); bars.className = 'pl-bars'; bars.innerHTML = '<i></i><i></i>'; document.body.append(bars);
  const root = document.createElement('div'); root.className = 'pl-hud';
  root.innerHTML = `
    <div class="pl-left" data-left>
      <div class="pl-bugwrap">
        <button class="pl-bug pl-glass" type="button" data-guide aria-expanded="false" aria-controls="pl-guide" title="Banguide (G)">
          <span class="pl-bug-hole"><small>Hål</small><b data-hole>1</b></span>
          <span class="pl-bug-main"><span class="pl-k" data-line1></span><b class="pl-bug-name" data-name>–</b>
            <span class="pl-bug-guide">${ICON.book}<span>Banguide</span><span class="pl-dots" data-dots></span></span></span>
          <span class="pl-bug-score"><small>Slag</small><b data-stroke>1</b><em data-topar></em></span>
        </button>
        <aside class="pl-guide pl-glass" id="pl-guide" data-guide-panel hidden aria-label="Banguide">
          <button class="pl-guide-close" type="button" data-guide-close aria-label="Stäng banguiden">×</button>
          <span class="pl-k">Banguide</span><h3 data-guide-title></h3><p class="pl-guide-sub" data-guide-sub></p><p data-guide-note></p><p class="pl-guide-from" data-guide-facts></p>
        </aside>
      </div>
      <section class="pl-dist pl-glass" data-dist aria-label="Avstånd" aria-live="polite">
        <div class="pl-dist-main"><span class="pl-k" data-to-label>Till hål</span><b class="pl-dist-big" data-to>–</b><span class="pl-dist-plays" data-plays></span></div>
        <div class="pl-ladder" data-green hidden title="Greenens bakkant, mitt och framkant">
          <span><i>Bak</i><b data-g="back">–</b></span><span class="mid"><i>Mitt</i><b data-g="centre">–</b></span><span><i>Fram</i><b data-g="front">–</b></span>
        </div>
        <div class="pl-dist-rows" data-rows></div>
      </section>
    </div>
    <div class="pl-right" data-right>
      <div class="pl-top">
        <button class="pl-btn pl-glass pl-live-btn" data-replay type="button" hidden title="Repris (R)" aria-label="Repris">${ICON.replay}<span>Repris</span></button>
        <button class="pl-btn pl-glass" data-view type="button" title="Kamera: bakom bollen, översikt, greenen, fri (V)" aria-label="Kamera: Bakom">${ICON.camera}<span data-view-label>Bakom</span></button>
        <button class="pl-btn pl-glass" data-menu type="button" aria-label="Meny" title="Meny (Esc)">${ICON.menu}</button>
      </div>
      <section class="pl-cond pl-glass" data-condcard aria-label="Förhållanden">
        <div class="pl-wind" data-wind>${DIAL}<div class="pl-wind-text"><b><span data-wind-ms>–</span><small>m/s</small></b><span data-wind-word></span></div></div>
        <div class="pl-cond-row"><span class="pl-k">Läge</span><b data-lie>Tee</b><em data-lie-pct></em></div>
        <i class="pl-liebar" data-liebar><i></i></i>
        <div class="pl-cond-sub" data-slope></div>
        <div class="pl-cond-row" data-cond-row><span class="pl-k">Väder</span><b data-cond>–</b></div>
      </section>
      <div class="pl-map-slot" data-map-slot></div>
    </div>
    <div class="pl-dock">
      <div class="pl-clubs pl-glass" role="group" aria-label="Klubba">
        <button type="button" data-club="-1" aria-label="Längre klubba" title="Längre klubba (↑)">‹</button>
        <div class="pl-club"><span class="pl-k">Klubba</span><b data-club-name>–</b><span class="pl-n" data-club-carry></span></div>
        <button type="button" data-club="1" aria-label="Kortare klubba" title="Kortare klubba (↓)">›</button>
      </div>
      <button class="pl-glass pl-setup-btn" data-setup type="button" aria-expanded="false" aria-controls="pl-setup-panel" title="Slagets typ, form, höjd och spinn (T)"><span class="pl-k">Slag</span><b data-setup-text>Full</b></button>
      <div class="pl-setup-panel pl-glass" id="pl-setup-panel" data-setup-panel hidden role="group" aria-label="Slaget">
        <div class="pl-row" data-row="type"><span class="pl-k">Typ</span><div class="pl-seg" data-pick="type"></div></div>
        <div class="pl-row" data-row="shape"><span class="pl-k">Form</span><div class="pl-seg" data-pick="shape"></div></div>
        <div class="pl-row" data-row="height"><span class="pl-k">Höjd</span><div class="pl-seg" data-pick="height"></div></div>
        <div class="pl-row" data-row="spin"><span class="pl-k">Spinn</span><div class="pl-seg" data-pick="spin"></div></div>
        <p class="pl-keys">Tangenter: T typ · Q E form · W S höjd · Z C spinn</p>
      </div>
    </div>
    <aside class="pl-stats pl-glass" data-stats aria-live="polite"></aside>
    <div class="pl-power pl-glass" data-power></div>
    <div class="pl-banner pl-glass" data-banner role="status"><b></b><span></span></div>
    <div class="pl-third pl-glass" data-third aria-live="polite"><span class="pl-third-kicker" data-third-kicker></span><b data-third-title></b><span class="pl-third-sub" data-third-sub></span><p data-third-body></p></div>
    <span class="pl-live" data-live><i></i><span data-live-text>Repris</span></span>
    <span class="pl-skip" data-skip>Tryck eller mellanslag för att hoppa över</span>
    <span class="pl-clean-hint pl-glass">Ren vy · H eller Esc visar panelerna igen</span>
    <div class="pl-help" data-help></div>`;
  document.body.append(root);
  const fade = document.createElement('div'); fade.className = 'pl-fade'; document.body.append(fade);
  const sheet = document.createElement('div'); sheet.className = 'pl-sheet';
  sheet.innerHTML = `<div class="pl-sheet-box pl-glass" role="dialog" aria-modal="true"></div>`;
  document.body.append(sheet);
  const q = s => root.querySelector(s);
  q('[data-menu]').onclick = onMenu;
  q('[data-view]').onclick = () => onView?.();
  q('[data-replay]').onclick = () => onReplay?.();
  for (const b of root.querySelectorAll('[data-club]')) b.onclick = () => onClub(Number(b.dataset.club));
  const guideButton = q('[data-guide]'), guidePanel = q('[data-guide-panel]');
  const toggleGuide = force => {
    const open = force ?? guidePanel.hidden;
    guidePanel.hidden = !open; guideButton.setAttribute('aria-expanded', String(open));
    if (open) onGuide?.();
  };
  guideButton.onclick = () => toggleGuide();
  q('[data-guide-close]').onclick = () => toggleGuide(false);
  q('[data-rows]').addEventListener('click', e => { if (e.target.closest('[data-clear-target]')) onClearTarget?.(); });
  const setupButton = q('[data-setup]'), setupPanel = q('[data-setup-panel]');
  const toggleSetup = force => {
    const open = force ?? setupPanel.hidden;
    setupPanel.hidden = !open; setupButton.setAttribute('aria-expanded', String(open));
    onSetupToggle?.(open);
  };
  setupButton.onclick = () => toggleSetup();
  setupPanel.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    onSetup?.(b.closest('[data-pick]').dataset.pick, b.dataset.v);
  });
  const help = text => { q('[data-help]').innerHTML = esc(text).replace(/(^|· )([^·]+?) ((?:[←→↑↓A-ZÅÄÖ](?: |$))+)/g, (all, lead, word, keys) => `${lead}${word} ${keys.trim().split(' ').map(k => `<kbd>${k}</kbd>`).join(' ')} `); };
  let bannerTimer = 0, flashTimer = 0, statsTimer = 0;
  return {
    root, sheet,
    /** Where the hole map lives. */
    get mapSlot() { return q('[data-map-slot]'); },
    get left() { return q('[data-map-slot]'); },
    /** The scorebug: the hole, its name, the stroke and the round so far. */
    hole({ n, par, length, strokes, name, index = null, received = 0, toPar = null, points = null }) {
      q('[data-hole]').textContent = n;
      q('[data-line1]').innerHTML = `Par ${esc(par)} · ${esc(length)} m${index != null ? `<span class="pl-idx"> · index ${esc(index)}</span>` : ''}`;
      q('[data-name]').textContent = name || `Hål ${n}`;
      q('[data-dots]').innerHTML = received > 0 ? '<i></i>'.repeat(Math.min(4, received)) : '';
      q('[data-dots]').title = received > 0 ? `${received} extraslag med ditt handicap` : '';
      q('[data-stroke]').textContent = strokes + 1;
      const tp = q('[data-topar]');
      tp.textContent = points != null ? `${points} p` : toPar == null ? '' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `−${-toPar}`;
      tp.className = points == null && toPar ? (toPar < 0 ? 'under' : 'over') : '';
      guideButton.setAttribute('aria-label', `Hål ${n}, par ${par}, ${length} meter${name ? `, ${name}` : ''}. Slag ${strokes + 1}. Banguide`);
    },
    /** The hole's page of the course guide. */
    guide({ title, sub, note, facts }) {
      q('[data-guide-title]').textContent = title; q('[data-guide-sub]').textContent = sub;
      q('[data-guide-note]').textContent = note || 'Klubben har ingen text om det här hålet.';
      q('[data-guide-facts]').textContent = facts || '';
    },
    toggleGuide,
    get guideOpen() { return !guidePanel.hidden; },
    view(label) {
      q('[data-view-label]').textContent = label;
      q('[data-view]').setAttribute('aria-label', `Kamera: ${label}`);
    },
    /** The distance panel and the conditions card. */
    shot({ toPin, lie, liePct = null, lieTitle = '', slope = '', plays = '', playsTitle = '', windMs = 0, windDeg = 0, windLabel = '', windWord = '',
      green = null, target = null, hazards = [], cond = null, toLabel = 'Till hål' }) {
      q('[data-to-label]').textContent = toLabel;
      q('[data-to]').innerHTML = `${metres(toPin)}<small>m</small>`;
      const playsEl = q('[data-plays]');
      playsEl.hidden = !plays; playsEl.innerHTML = plays; playsEl.title = playsTitle;
      const greenEl = q('[data-green]');
      greenEl.hidden = !green;
      if (green) for (const key of ['back', 'centre', 'front']) greenEl.querySelector(`[data-g="${key}"]`).textContent = Number.isFinite(green[key]) ? Math.round(green[key]) : '–';
      const rows = [];
      if (target) rows.push(`<div class="pl-row-item target">${ICON.target}<span>Mål <b>${metres(target.dist)} m</b>${target.plays != null ? ` · spelas <b>${Math.round(target.plays)}</b>` : ''}</span><button type="button" data-clear-target aria-label="Ta bort målet" title="Ta bort målet (Backsteg)">×</button></div>`);
      for (const z of hazards.slice(0, 2)) {
        rows.push(z.type === 'vatten'
          ? `<div class="pl-row-item water">${ICON.water}<span>Vatten · kort om <b>${Math.round(z.from)}</b> · bär <b>${Math.round(z.to)}</b> m</span></div>`
          : `<div class="pl-row-item sand">${ICON.sand}<span>Bunker ${z.to - z.from < 3 ? `vid <b>${Math.round(z.from)}</b>` : `<b>${Math.round(z.from)}–${Math.round(z.to)}</b>`} m</span></div>`);
      }
      q('[data-rows]').innerHTML = rows.join('');
      const wind = q('[data-wind]');
      wind.querySelector('.pl-dial').style.setProperty('--deg', `${windDeg}deg`);
      wind.classList.toggle('calm', !(windMs > .2));
      q('[data-wind-ms]').textContent = windMs > .2 ? windMs.toFixed(1).replace('.', ',') : '0';
      q('[data-wind-word]').textContent = windWord || (windMs > .2 ? '' : 'Stilla');
      wind.title = windLabel;
      q('[data-lie]').textContent = lie;
      const pct = q('[data-lie-pct]');
      pct.textContent = liePct != null ? `${liePct} %` : '';
      pct.classList.toggle('warn', liePct != null && liePct < 85);
      q('[data-liebar]').hidden = liePct == null;
      q('[data-liebar]').style.setProperty('--p', liePct != null ? Math.max(0, Math.min(1, (liePct - 40) / 60)).toFixed(3) : 1);
      q('[data-slope]').textContent = slope || '';
      q('[data-lie]').closest('.pl-cond-row').title = lieTitle;
      q('[data-cond-row]').hidden = !cond;
      if (cond) { q('[data-cond]').textContent = cond.label; q('[data-cond-row]').title = cond.note; }
    },
    /** The club and how far it goes from here as set up (play-mode reachOf). Where that is not the
        bag's own full carry, the number says why on hover. */
    club({ name, carry, putt, range, stock = null, full = true, type = null }) {
      q('[data-club-name]').textContent = name;
      const el = q('[data-club-carry]');
      // another shot type than a full swing names itself: "Chip · 30 m" is a chip's run, not the club's
      el.textContent = putt ? `mätare ${range} m` : `${type ? `${type} · ` : ''}${Math.round(carry)} m`;
      const differs = !putt && Number.isFinite(stock) && (!full || Math.abs(carry - stock) >= 1.5);
      const words = !differs ? '' : full
        ? `Bär ${Math.round(carry)} m härifrån, som slaget är inställt. Fullt slag från fairway: ${Math.round(stock)} m.`
        : `Går ${Math.round(carry)} m i allt härifrån, som slaget är inställt. Fullt slag från fairway bär ${Math.round(stock)} m.`;
      el.title = words;
    },
    power(text) { clearTimeout(flashTimer); const el = q('[data-power]'); el.className = 'pl-power pl-glass'; el.textContent = text || ''; el.classList.toggle('show', Boolean(text)); },
    /** A word by the swing for a moment (the tempo's verdict). */
    flash(text, tone = '', ms = 1600) {
      const el = q('[data-power]');
      el.textContent = text; el.className = `pl-power pl-glass show ${tone}`;
      clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('show'), ms);
    },
    /** The shot's setup on its button and in its panel. */
    setup({ types, labels, current, shapeable, putt }) {
      setupButton.hidden = putt;
      if (putt) toggleSetup(false);
      const words = [labels.type[current.type]];
      if (current.shape) words.push(labels.shape[current.shape]);
      if (current.height) words.push(labels.height[current.height]);
      if (current.spin) words.push(labels.spin[current.spin]);
      q('[data-setup-text]').textContent = words.join(' · ');
      const seg = (key, options, value) => {
        q(`[data-pick="${key}"]`).innerHTML = options.map(([v, label]) =>
          `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`).join('');
      };
      seg('type', types.map(t => [t, labels.type[t]]), current.type);
      seg('shape', [-2, -1, 0, 1, 2].map(v => [v, labels.shape[v]]), current.shape);
      seg('height', [-1, 0, 1].map(v => [v, labels.height[v]]), current.height);
      seg('spin', [-1, 0, 1].map(v => [v, labels.spin[v]]), current.spin);
      q('[data-row="shape"]').classList.toggle('off', !shapeable);
      q('[data-row="type"]').classList.toggle('off', types.length < 2);
    },
    toggleSetup,
    get setupOpen() { return !setupPanel.hidden; },
    /** The last shot's numbers as one strip (null hides it). autoHide in ms, 0 keeps it. */
    stats(data, autoHide = 0) {
      const el = q('[data-stats]');
      clearTimeout(statsTimer);
      if (!data) { el.classList.remove('show'); return; }
      el.innerHTML = `<header><b class="${data.tone || ''}">${esc(data.title)}</b>${data.note ? `<span>${esc(data.note)}</span>` : ''}</header>
        <dl>${data.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${figure(v)}</dd></div>`).join('')}</dl>`;
      el.classList.add('show');
      if (autoHide) statsTimer = setTimeout(() => el.classList.remove('show'), autoHide);
    },
    replay(available) { q('[data-replay]').hidden = !available; },
    help,
    banner(title, sub = '', tone = '', ms = 2600) {
      const el = q('[data-banner]');
      el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub;
      el.className = `pl-banner pl-glass show ${tone}`;
      clearTimeout(bannerTimer);
      if (ms > 0) bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
    },
    hideBanner() { q('[data-banner]').classList.remove('show'); },
    /** Letterboxed moments (the flyover, a replay): null ends them. live puts a broadcast bug up ('Repris'). */
    cinema(mode, { live = null, skip = true } = {}) {
      document.body.classList.toggle('pl-cinema', Boolean(mode));
      const bug = q('[data-live]');
      bug.classList.toggle('show', Boolean(live));
      if (live) q('[data-live-text]').textContent = live;
      q('[data-skip]').hidden = !skip;
      if (!mode) this.third(null);
    },
    /** The lower third: { kicker, title, sub, body } or null. */
    third(data) {
      const el = q('[data-third]');
      if (!data) { el.classList.remove('show'); return; }
      q('[data-third-kicker]').textContent = data.kicker || '';
      q('[data-third-title]').textContent = data.title || '';
      q('[data-third-sub]').textContent = data.sub || '';
      q('[data-third-body]').textContent = data.body || '';
      el.classList.add('show');
    },
    /** A broadcast bug on its own (Återupplev's), or null. */
    live(text) { const bug = q('[data-live]'); bug.classList.toggle('show', Boolean(text)); if (text) q('[data-live-text]').textContent = text; },
    fade(on) { fade.classList.toggle('on', on); },
    openSheet(html) { const box = sheet.querySelector('.pl-sheet-box'); box.innerHTML = html; box.scrollTop = 0; sheet.classList.add('open'); return box; },
    closeSheet() { sheet.classList.remove('open'); },
    get sheetOpen() { return sheet.classList.contains('open'); },
    clean(on) { document.body.classList.toggle('pl-clean', on); },
    dispose() { root.remove(); fade.remove(); sheet.remove(); bars.remove(); style.remove(); document.body.classList.remove('pl-clean', 'pl-cinema'); },
  };
}

/** The card so far: holes in playing order, nine to a row with their sums, scores marked against par, points when there is a handicap. */
export function scorecardHtml(round, holes, points = null) {
  const played = round.order.filter(n => round.holes[n]?.holed || round.holes[n]?.picked);
  if (!played.length) return '<p class="pl-sub">Inga hål spelade ännu.</p>';
  const cells = played.map(n => {
    const card = round.holes[n], par = holes[n - 1].par, diff = card.strokes - par;
    return { n, par, strokes: card.picked ? null : card.strokes, cls: card.picked ? '' : diff < 0 ? 'under' : diff > 0 ? 'over' : '', points: points?.(n) ?? null };
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 9) {
    const part = cells.slice(i, i + 9);
    const sum = key => part.reduce((s, c) => s + (c[key] ?? 0), 0);
    const showPoints = part.some(c => c.points != null);
    rows.push(`<table class="pl-table"><tr><th>Hål</th>${part.map(c => `<th>${c.n}</th>`).join('')}<th class="sum">Σ</th></tr>
      <tr><th>Par</th>${part.map(c => `<td>${c.par}</td>`).join('')}<td class="sum">${sum('par')}</td></tr>
      <tr><th>Slag</th>${part.map(c => `<td class="${c.cls}"><span>${c.strokes ?? '–'}</span></td>`).join('')}<td class="sum">${sum('strokes')}</td></tr>${showPoints
        ? `<tr><th>Poäng</th>${part.map(c => `<td>${c.points ?? ''}</td>`).join('')}<td class="sum">${sum('points')}</td></tr>` : ''}</table>`);
  }
  return rows.join('');
}
