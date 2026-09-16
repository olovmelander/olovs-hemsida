# Banvy golfers — female and male character designs

Two native, rigged 3D characters share a warm stylized design language for Banvy's painted landscape. The female golfer follows the supplied Birdie reference with a raspberry polo, ivory undersleeves, checked pleated skort, sunglasses and ponytail. The male golfer has a separately fitted masculine face and anatomy, broader shoulders, short swept hair, sage polo, cream tailored trousers and an ivory/forest cap. Both have sculpted hands, a fitted golf glove, detailed shoes and matte materials. The male uses the artist-authored male anatomy, replacing the earlier primitive blockout.

**Status: development prototype; app integration is deferred.** Start the separate lab with `npm --prefix apps/golf run dev:golfer`. See the [development handoff](../../../experiments/golfer/README.md) for the saved checkpoint, resume steps and integration plan.

## Review

- [Character studio](http://localhost:5180/golfer-study.html): choose Female or Male, inspect from the Front/Side/Back buttons, scrub, slow down, choose a club, and walk with camera-relative WASD. “Move across the ground” shows the selected walk, backward step, strafe or jog at its authored travel speed. Switching characters preserves position, heading, club, pose and playback settings.
- [Animation audit gallery](animation-audit/index.html): all 40 clips, each with four poses from the front, side and back. [Findings and measurements](animation-audit/README.md).
- [Male golfer directly](http://localhost:5180/golfer-study.html?character=male). The `character` parameter also works on the course; links between the studio and course retain the selection.
- [Puttom course preview](http://localhost:5180/?bana=puttom&golfer=1&ghibli=1&ljus=dag): WASD movement, Shift jogging, touch direction buttons, setup and swing, and return to the current tee. Close the panel to release the actor and restore the camera controls.
- `banvy-golfer.blend`: native editable scene with the 39-bone rig, all 20 actions, separate clubs, packed check texture, studio lights, and hidden CC0 source anatomy.
- `banvy-golfer-male.blend`: independent male rig, body, source sculpt and 20 actions.
- `banvy-golfer-pair.blend`: both individual ateliers and a scene showing them together; 40 native actions in total. This is also the current scene in the connected Blender session.
- `golfer-pair.png` and `golfer-male-portrait.png`: actual Blender renders of the pair and male design.
- `golfer-portrait.png`: actual Blender render.
- `golfer-browser.png`, `golfer-backswing.png`, `golfer-impact.png`, `golfer-mobile.png`, and `golfer-on-course.png`: browser review captures.
- Runtime assets: `experiments/golfer/assets/banvy-golfer.glb` / `golfer.json` and `banvy-golfer-male.glb` / `golfer-male.json`. Each loads independently; only the selected character is retained in the browser.

The lab course viewer loads the golfer when `golfer=1` is requested on port 5180. Normal development and production builds do not enable that integration. Normal production builds omit the golfer studio, model files and runtime modules. The native source is retained independently of the user's existing Blender files; it was authored through the local bridge on port 9876.

## Motion

Each character has twenty named, baked skeletal actions: Idle; Walk; WalkBackward; StrafeLeft; StrafeRight; Jog; TurnLeft; TurnRight; AddressDriver; AddressWood; AddressIron; AddressWedge; AddressPutter; SwingDriver; SwingWood; SwingIron; ChipWedge; Putt; ClubChange; Celebrate. They use the same locomotion and stroke timing, with separate finger fitting and weights for each anatomy.

Revision 2 replaces all forty actions at **60 fps**. Walking elbows bend back, knees bend forward, and each arm opposes its own leg. Heel strike, toe-off and matching travel speeds reduce foot sliding. Full strokes have separate takeaway, backswing, downswing, impact and follow-through poses, pelvis/chest rotation and a planted trailing toe as its heel rises. Time-aware curves keep the club moving through impact.

The five clubs share an animated grip socket. Arm posing uses stable hinge normals and separate anatomical palm targets for each hand; wrist flexion is limited while preserving the grip. The shorter clubs use lower address poses. Native turn actions rotate the root by 90 degrees; the browser transfers that rotation to the actor so subsequent movement and character switches keep the heading. Blender forward is -Y; exported forward is +Z; the right-handed strike travels +X. Club faces, aim and ball flight now use that same shot direction.

The course preview adjusts the stance elevation to the ball and fits the leg chains to modest local slopes. Impact metadata triggers one event per stroke. Scrubbing isolates the selected action and never triggers gameplay events. Interrupted transitions cannot accumulate contributions from a third action.

This is a character and animation preview. Ball flight is illustrative. There is no scoring, golf-ball collision/roll simulation, building/tree navigation mesh, or full terrain-aware swing correction. Facial expressions, secondary ponytail motion, cloth simulation and production LODs are not included. Clothing uses skeletal deformation and should receive further art review under extreme poses. Both actors are about 2 m tall; the female body is roughly 73k triangles and the male roughly 58k, intended for close visual review.

## Sources and rights

The anatomical starting meshes are the **stylized female and stylized male** from [Blender Studio's Human Base Meshes v1.4.1](https://download.blender.org/demo/asset-bundles/human-base-meshes/), released as **CC0** according to the bundle's `README`. They are adapted, clothed, fitted to the rigs and animated in Blender. See also [Blender Studio's base-mesh workflow](https://studio.blender.org/training/stylized-character-workflow/base-meshes/).

The supplied [Birdie article](https://inews.co.uk/culture/gaming/birdie-fortnite-skin-teed-off-set-how-much-cost-280510) could not be fetched by the web reader. The [official promotional image hosted by Epic](https://cdn2.unrealengine.com/12br-birdie-motd-1920x1080-1920x1080-175496429.jpg) was inspected as a visual reference. No Fortnite mesh or texture is included in the exported character. Outfit geometry, check pattern, clubs and animation were authored for this study.

## Rebuild and verify

From the repository root, start `npm --prefix apps/golf run dev:golfer` in a separate terminal. With Blender's local MCP bridge enabled on port 9876:

```powershell
python tools/blender-golfer/fetch_source.py
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/build_golfer.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/refine_golfer.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/finish.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/build_male.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/finish_pair.py --timeout 240
node tools/blender-golfer/review.mjs
node tools/blender-golfer/review.mjs male
node tools/blender-golfer/check.mjs
node tools/blender-golfer/check.mjs male
node tools/blender-golfer/check_pair.mjs
node tools/blender-golfer/audit_motion.mjs
node tools/blender-golfer/check_directions.mjs
npm --prefix apps/golf run build:golfer
```

`build_golfer.py` recreates only the generated female atelier and rig. `refine_golfer.py` installs the refined anatomy and outfit. `build_male.py` clones the animation contract into an independent male atelier and runs the shared fitting pipeline with the male design. Its NLA export isolates the selected rig's actions. `finish_pair.py` renders the pair and checks each native file retains every action.

For motion-only changes to existing ateliers, run `rebake_animations.py` through the same bridge, followed by `finish.py`, `finish_pair.py` and the browser audits. `animation.py` is the shared source for both fitted rigs. Every export requires a fresh audit; a passing audit records its matching GLB hash and updates the manifest validation status.

Browser validation checks every clip's sampled skin bounds, one impact per stroke, club-head contact height, exclusive club visibility, keyboard movement, mobile layout and terrain grounding for both characters. Pair tests exercise state preservation, resource disposal, failed loads, rapid selection and closing during a pending switch. See `verification-female.json`, `verification-male.json`, `verification-pair.json` and `blender-pair-audit.json`.

The motion audit measures joint continuity, loop seams, elbow/knee bend directions, arm/leg phase, grip separation, wrist bend, foot contact and strike direction in the actual exported models. The direction audit exercises camera-relative keys, turns followed by walking, eight aim headings, and contact/ball travel with all five clubs for both characters on Puttom.
