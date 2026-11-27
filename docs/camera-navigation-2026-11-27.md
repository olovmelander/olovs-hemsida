# Moving through the detailed course with a mouse and a keyboard

27 November 2026. Owner request: moving around in Detaljerad 3D with the mouse
and the keyboard should be tighter, smoother and better.

Source: `apps/golf/src/ui/camera-navigation.mjs`, bound from `entry.js` once the
course is up. Tests: `camera-navigation.test.mjs` beside it. The measured check:
`tools/check-camera-navigation.mjs`.

## What was wrong

The detailed course was driven by three's stock `OrbitControls` with a damping
factor of 0.055. Measured on Puttom's first hole at 1600 x 900 on the GPU
(`tools/check-camera-navigation.mjs`, the "stock" column below):

- **The camera lagged the hand.** A drag was applied a twentieth at a time, so
  half of a turn was on screen after 0.15 to 0.2 s and nine tenths after 0.5 to
  0.65 s, and it coasted as long after the button was released.
- **It turned round a point the golfer had not chosen.** A named view leaves the
  orbit target at its aim: 200 m down the fairway from a tee. A 300 px drag from
  the tee swung the camera 395 m through the trees to turn the view 120 degrees.
- **The pan slid in the screen's plane.** The ground taken hold of ended 145 px
  from the cursor, and the eye 15 m lower.
- **The zoom went to the middle of the screen, in steps.** Each notch was one
  frame's jump of 5%, and the ground under the cursor ended 204 px away.
- **There were no keys for moving**, only for holes, views and lights.

## What it does now

| Hand | What it does |
|---|---|
| Left drag | Turns the world round the ground taken hold of, which stays under the cursor. |
| Left drag on far ground or the sky | Turns the eye in place; the scene follows the hand. |
| Right drag | Moves the ground: the point taken hold of stays under the cursor. |
| Middle drag | Turns the eye in place, from anywhere. |
| Wheel | Zooms toward the ground under the cursor, eased over frames. |
| `W` `A` `S` `D` | Walk, level with the view's heading. |
| `Q` `E` | Sink and rise. |
| `Shift` | Three times the pace. With a drag: swaps left and right, as before. |

Touch, the tweens between views, the flights, the tour and the ground clamp are
unchanged. Spela and Återupplev keep the stock controls round the ball.

The rules behind it, all tunable in `NAVIGATION`:

- **Owed, then paid out.** Every gesture is an amount still owed, and each frame
  pays a share `1 - exp(-dt / tau)` of it: 40 ms for drags, 80 ms for the wheel.
  The picture is the same at 60 and 144 Hz. The stock damping was a fixed share
  per frame, so its feel changed with the frame rate.
- **A drag let go while moving glides** for 0.12 s of its speed; one that stopped
  first stays exactly where it was put.
- **What a left drag swings round** depends on how far away the ground is. From
  standing height the camera swings round ground within 10 m (the cup, the
  ball). That reach grows with the height above the ground, as its 1.5th power,
  and is never more than 1.5 times the distance to the ground at the middle of
  the view. Past the reach the swing gives way to turning the eye, completely by
  three reaches. So a drag never throws the camera across the course.
- **The pan never takes hold of the horizon.** A ray flatter than 2.5 degrees
  below level is read as that slope.
- **The keys' pace follows the height above the ground**: 5 m/s at standing
  height, 0.9 heights a second once that is faster.
- **Reduced motion** pays everything at once: nothing is eased and nothing glides.

## The ground

The ground clamp (`engine/camera-clamp.mjs`) is still the only thing that lifts
the camera out of the ground. Navigation adds two rules of its own, and neither
is a clamp or a snap to terrain:

1. **A frame of navigation never steers the eye under standing height.** A swing,
   a zoom or `Q` that would is held at standing height while the view still
   turns. The clamp is therefore never fought, and it books no lift for it.
2. **A movement begun near the ground rides it.** The eye is carried by what the
   ground under it rose or fell, read as the mean of nine heights over a
   footprint 1.5 to 6 m wide. A walk down a fairway no longer leaves the eye in
   the air. A movement begun in the air flies level.

The share of the ground's rise and fall a movement rides is taken once, where it
begins (all of it under 3 m, none above 10 m), and kept for its length. Read
every frame from the current height instead, the share would not be symmetric:
over a hill the camera would take more of the fall on the far side than of the
rise on the near side and "land", and the clamp would be left with lift on its
books to pay back later, when the golfer next rose. This was reasoned from the
clamp's ledger before anything was built, not measured. A share fixed for the
movement gives back what it took: over a 4 m hill and down again the test leaves
the eye at standing height and the clamp owed under a centimetre.

## Where it lives, and why

`main.js` and `engine/` feed the prepared startup data's source revision
(`tools/course-source-revision.mjs`), so an edit there turns the prepared data
off until the next GPU bake. This module is in `apps/golf/src/ui`, outside the
hashed folders, and `main.js` is not edited:

- It reaches the course through `window.V3D` (`harness()`, `groundAt`,
  `groundClamp()`), as `ui/detailed-hud.mjs` does.
- It steps inside the controls' own `update()`, which `main.js` calls once a
  frame while the player owns the camera: after a tween has placed the camera,
  before the ground clamp.
- It announces a gesture as the controls' own `start` event, which is what
  already stops a tween, a flight or a tour
  (`engine/camera-gesture-interrupt.mjs`).
- For a mouse drag it sets the controls' `mouseButtons` aside, so they stay in
  their `NONE` state. For the wheel it turns `enableZoom` off for the length of
  the event's dispatch. The event still reaches the canvas and its listeners.
- A camera placed by anything else (a tween, a named view, the GPS) is noticed
  by comparing the pose with the one the last frame left, and what the hand
  holds is taken hold of again from there.

Its keys are held, not pressed, so they are in `NAVIGATION_ROWS` here and not in
`engine/keyboard-shortcuts.mjs` (hashed). The menu's list and the hint under the
course are filled in when the module is bound.

## Measured

`BANVY_GPU=1 node tools/check-camera-navigation.mjs --course puttom` against the
production build, 1600 x 900, 60 Hz cap, RTX 5080. Every gesture is made twice on
the same page from the same view: with the navigation on, and with
`BANVY_NAV.setEnabled(false)`.

| Puttom, hole 1 | New | Stock |
|---|---|---|
| Drag: half of the turn after | 0.03 s | 0.18 s |
| Drag: nine tenths of it after | 0.10 s | 0.58 s |
| Drag: the ground held ends off by | 0 px | 293 px |
| Pan: the ground held ends off the cursor | 0 px | 145 px |
| Pan: the eye rose | 0 m | −14.9 m |
| Zoom: the ground under the cursor ends off by | 0 px | 204 px |
| Zoom: largest share of five notches in one frame | 0.07 | 0.22 |
| Zoom: frames it is drawn over | 52 | 5 |
| Look round from the tee: the eye moved | 0 m | 395 m |
| `W` for four seconds | 20.1 m | 0 m |
| Walking: the eye above the ground | 1.70 to 1.73 m | — |
| Walking: largest change of the eye's vertical step | 1.2 mm | — |
| Walking: lift the ground clamp is left owed | 0 m | — |

Tjusta, Visby and Norrfällsviken pass the same gates. On Visby nine tenths of a
drag took 0.2 s, where frames are longer; the gate is 0.3 s.

Also checked in the browser: a drag, the wheel and a key each take the camera
from a view's tween, and a drag from a flight; a finger still turns the view and
stops a flight through the stock controls, and a pinch still zooms; `W` does
nothing behind the open menu or in a text field; the arrows and digits are still
the course's own; no console errors.

The production build's prepared startup data still matches the source revision
(`tools/check-prepared-startup.mjs`), and the module is its own 5.5 kB chunk
(gzip), fetched after the course is up.

## Befores

- `?nav=before` is the stock controls. `nav` is not on
  `preparedTintAllowed`'s display-only list (that list is hashed), so this URL
  boots without the prepared tint, as `?spela=1` does.
- `BANVY_NAV.setEnabled(false)` in the console is the same on a running page,
  and is what the check compares against.

## Not done

- No double-click, no pointer lock and no cursor change while dragging
  (`main.js` sets the canvas cursor on every move).
- The pivot is the ground, not a tree or a roof: taking hold of a crown turns the
  world round the ground behind it.
- Phone and touch gestures are as they were.
