# Golfer animation audit — revision 2

[Interactive studio](http://localhost:5180/golfer-study.html) · [Pose gallery](index.html) · [Motion measurements](measurements.json) · [Application direction checks](directions.json)

Both characters have twenty rebuilt actions, baked at 60 fps. The audit loads the shipped GLBs in the application's Three.js runtime. Joint, hand and club measurements run at 120 Hz, including between keys; sampled skinned shoe vertices are checked at 30 Hz. The gallery contains 480 rendered views: forty clips, four phases, three camera directions.

## Problems corrected

- Walking arm targets put the elbows in front of the body and did not consistently oppose their own legs. Elbows now bend backward, with a quiet counter-swing, heel strike and toe-off.
- Arm roll references could become unstable as the forearm changed direction. Roll now follows the elbow hinge; the lead and trailing elbows have distinct swing paths. Wrist flexion is limited to 65 degrees in the authored poses.
- Wrist targets alone did not guarantee a two-handed grip. Each fitted hand now has a palm grip marker, with its own offset along the handle.
- Carrying, jogging and celebration hands now follow the forearm's neutral wrist. This removes the over-bent raised wrist in the celebration; wrist limits are checked in every clip.
- The club stopped at the old impact key. Continuous curves now carry it through the ball, with connected downswing and release paths.
- Club-face, swing and preview-ball directions disagreed. All five clubs now strike along local +X; aiming transforms this into the course target direction.
- Quarter turns and character switching could disagree about heading beyond 90 degrees. Native root turns now become actor heading in the runtime, with yaw-preserving rotation order.
- Raising the trailing heel moved its toe. Follow-through now rotates around a fixed toe contact. A small undershorts/skort intersection at the female finish was also corrected.

## Measured results

These are numerical tolerances for the current stylized animation, not a motion-capture or biomechanical certification.

| Measurement across both characters | Result |
| --- | --- |
| Maximum palm-to-handle deviation, including interpolation | 6.61 mm |
| Maximum wrist bend in golf clips | 65.88° |
| Maximum sampled planted-foot drift, including jog toe-off | 3.15 mm |
| Maximum toe drift during full strokes | 0.207 mm |
| Lowest sampled shoe surface above the studio floor | 6.00 mm |
| Largest loop-end positional gap | 0.00143 mm |
| Minimum club-face alignment with the shot direction | 0.9974 cosine similarity |
| Motion and browser errors | See the machine-readable reports above |

The audit asserts continuous joint rotations, forward-bending knees, backward-bending walking elbows, opposite arm/leg phase, grip contact, ground clearance, matching strike metadata, forward club velocity through impact and consistent face direction. Direction tests check W/A/S/D from three camera orientations, both quarter turns followed by walking, eight aim headings and actual ball contact for each club on the course. Existing checks also cover all animation events, club visibility, mobile layout, resource disposal and interrupted character loads.

## Visual review and remaining scope

Front, side and back frames were reviewed for walking, jogging, full swings, chips and putting on both designs. The studio offers slow playback, timeline scrubbing, fixed views and optional travel across the floor for further art review. The edited `.blend` files retain the native actions and both individual rigs.

These are authored stylized motions. Ball flight remains illustrative; there is no golf simulation, collision-aware swing planning, cloth simulation or secondary hair animation. Terrain fitting handles modest local slopes, not arbitrary lies or obstacles. The mesh and clothing still warrant production art review for any additional poses or changes in body proportions.

Golf references used for the direction and pose review: [PGA grip guidance](https://www.pga.com/story/get-a-grip-the-right-grip-for-you), [backswing and weight transfer](https://www.pga.com/story/power-up-your-golf-swing), [balanced finish](https://www.pga.com/story/become-a-better-ball-striker-the-golf-ball-isnt-the-finish-line), and [club-face alignment](https://www.pga.com/story/hit-the-golf-ball-where-you-want).

Run `node tools/blender-golfer/audit_motion.mjs` and `node tools/blender-golfer/check_directions.mjs` with the development server on port 5180. Use `--metrics-only` for numerical verification without recapturing unchanged pose images. The report records the exact GLB hash it measured.
