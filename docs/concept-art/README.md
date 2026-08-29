# Concept art — NOT photographs, NOT renders

Six generated images, one per course, that briefly shipped as the course
chooser's poster stills. They are kept because someone made a deliberate visual
choice with them and that choice should stay recoverable. They are **out of the
app** because of what they are.

**These are not photographs of these golf clubs, and they are not renders from
this engine.** They are synthetic images: photoreal-looking pictures of places
that do not exist, carrying the names of six real, operating Swedish golf clubs.
`veckefjarden.png` puts a flag reading **16** on what is meant to be
Veckefjärden's island 14th, over a green whose shape matches nothing in the
club's own survey — which is the quickest way to see that the picture is not of
the course.

A visitor scanning a card headed **VECKEFJÄRDENS GOLFKLUBB** reads the picture
above it as that club. Shipping these would tell six real businesses' customers
something untrue about those businesses, and the chooser's own source comment
said the opposite was happening:

> The stills are rendered by the shot harness, so they are pictures of the thing
> itself and cannot fall out of date with it.

That comment is now true again. `apps/golf/public/courses/<slug>/hero-1.png` is
a still shot from the engine by `geobuild/shot.mjs`, of the same geometry the
app renders when you open that course — the same discipline as every other claim
in this repo, where the card is the club's card and the ground is the ground the
DEM measured.

The renders are plainer than these images. That is the correct trade: a plain
picture of the real thing beats a beautiful picture of a different thing,
especially when the thing has a name and an address.

If a course deserves a more striking poster, the fix is a better camera — a
different hole, light preset, or time of day through the shot harness — not a
different course.
