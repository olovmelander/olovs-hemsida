# olovs-hemsida

**[Banvy — svenska golfbanor i 3D](https://olovmelander.github.io/olovs-hemsida/)**

Seven Swedish golf courses rendered in real time from real ground: AWS Terrarium
elevation, OpenStreetMap survey, club GPS surveys and orthoimagery, reconciled by
a per-course pipeline and checked against each club's own scorecard. The app is
installable, and a course you have already opened works with no network at all.

## The app

<https://olovmelander.github.io/olovs-hemsida/>

Pick a course from the front door, or deep-link straight into one:

    ?bana=veckefjarden&hal=14&vy=green      the island 14th, from the approach
    ?bana=norrfallsviken&ljus=host          autumn light
    ?bana=upsala&tee=6                      the sixth tee on a six-tee card

The full grammar is `bana hal vy ljus tee skylt ren kiosk q gl`.

## The standalone pages

Each course also exists as one self-contained page — no build step, no
dependencies — and every one of these URLs keeps working:

| | |
|---|---|
| [Veckefjärdens GC](https://olovmelander.github.io/olovs-hemsida/veckefjarden3d.html) | Mästerskapsbanan at the fjärd, and the island 14th |
| [Norrfällsvikens GK](https://olovmelander.github.io/olovs-hemsida/norrfallsviken3d.html) | seaside links character on the High Coast |
| [Puttom (Örnsköldsviks GK)](https://olovmelander.github.io/olovs-hemsida/puttom3d.html) | forest and parkland between two lakes |
| [Ängsö GK](https://olovmelander.github.io/olovs-hemsida/angso3d.html) | the Mälaren peninsula north of Ängsön |
| [Upsala GK](https://olovmelander.github.io/olovs-hemsida/upsala3d.html) | Håmö gård, west of Uppsala |
| [Johannesberg G&CC](https://olovmelander.github.io/olovs-hemsida/johannesberg3d.html) | the manor course at Gottröra |
| [Veckefjärdens GC (2023)](https://olovmelander.github.io/olovs-hemsida/veckefjardensgc.html) | the earlier page, in its own local frame |

## Building and checking

    pnpm install
    pnpm --filter @banvy/golf build          # the app
    node tools/check-app.mjs                 # every course, through the app
    node tools/check-links.mjs               # every URL that ever worked
    node tools/check-pwa.mjs                 # it really works offline
    node tools/check-basepath.mjs            # it really works under /<repo>/

`CLAUDE.md` is the working notebook: where each course's geometry comes from,
what each gate protects, and the mistakes that are worth not repeating.

Deployed by `.github/workflows/pages.yml` on every push to `main`.
