# The club wheel

The feature the map is built around (owner request, 5 November): a wheel that is always
on screen, where a player picks a club and locks the shot. Two locks make a shot, and
every shot of every round becomes a player's true distances and how they play each hole.

## The goal, and the order it comes in

1. **Now:** choose a club in a second, get the length of every shot, and let the card
   fill itself.
2. **Next:** a player's own lengths drive the suggestions, the stats grow (below), and a
   hole shows how it has been played before.
3. **Later:** rounds leave the phone, so they survive a new phone and can be compared.

The first version stores everything needed for the rest, because a shot that was not
recorded cannot be recovered: each one keeps both fixes, their accuracy, the lies, the
height gained and when it was struck.

## Using it

It has to be obvious with a glove on, in sunlight, in the middle of a conversation.

- **It is always there,** on the right under the distances, where the thumb rests and
  where every hole is framed clear of it. Five clubs show on a tall phone and three on a
  short one, and it moves to the left when the phone lies on its side. It turns for ever,
  with the putter next to the driver, so there is no end to run into.
- **It is already right.** The wheel rests on the suggested club for the shot in hand, or
  for the measured point, and turns by itself as the player walks. On the green it turns
  to the putter.
- **A finger overrules it at once.** Spin it, or tap a club. The suggestion keeps a yellow
  dot, so it is never lost. A new hole, or the walk to the next ball, hands the wheel back
  to the suggestion.
- **Hold to lock,** for 0.9 s, anywhere on a club. The club under the finger fills and the
  whole panel lights up, since a thumb covers the band, and the phone gives a tick where
  it can. Nothing moves under a finger that is holding. It is a hold and not a tap so that a pocket or a stray
  thumb cannot start a shot. Letting go early changes nothing.
- **The reward comes straight after:** "Driver 231 m", with Ångra and Plikt +1 beside it.
- **By the ball** the band turns green: that one sign says it is locked.
- **While walking,** the length counts up in large figures under the wheel.

The Mät slag button is gone: the wheel does its job.

## What happens at each lock

| The situation | What the player does | What is recorded |
| --- | --- | --- |
| Standing at the ball, first shot | Holds the club | A shot opens at this fix |
| Standing at the ball, next shot | Holds the next club | The last shot ends here, with its length and lie, and the new one opens |
| On the next tee, inside the tee's 20 s | Holds the club | The new hole begins at once, and the lock is its first shot |
| Second lock within 12 m | Chooses Byt klubba, Nytt slag or Omslag +1 | Changed club, a duffed shot, or stroke and distance |
| Slip of the thumb | Ångra | One step back, whatever the last step was |
| Ball in water or a penalty area | Plikt +1 after the next lock | A stroke on the shot that went in, which leaves the lengths |
| Out of bounds or lost, played again from the spot | Omslag +1 | The shot stays a stroke and leaves the lengths; a new one opens at the same spot |
| On the green | Holds the putter once, taps the number of putts | The approach ends here, and the hole's score is written: shots, penalties and putts |
| A lock forgotten, so a shot runs far past its club | Nothing | It shows with a question mark, and leaves the lengths |
| Chip-in, or the putter never held | Nothing | The next tee closes the shot with no length, and the prompt offers the logged strokes |

## Being honest about GPS

A phone is good to about 5 m, and both ends of a shot carry that error, so one shot's
length is rough. That shapes the design:

- **A club's length is told by many shots,** never one. Below five shots it shows no figure
  and changes no suggestion.
- **Lengths are total, roll included.** The ball stops where it stops. They are not carry,
  and the bag's figures are, so the two are not the same thing. The wheel says what the
  player really gets.
- **Chips and tops must not drag a club down.** A player will not mark every half shot, so
  the lower third of a club's shots is set aside and the typical length is the median of
  the rest.
- **A fix worse than ±15 m** still counts the stroke, but says nothing of a length.
- **Putts are counted, never measured:** they are shorter than the error.
- **A player must stand at the ball.** The lock is taken as the ball's spot.
- **A position over 10 s old is not trusted:** a phone just woken shows where it was. A
  lock waits up to 10 s for a fresh fix, and otherwise asks to be held again.

Height and wind are not taken out of the lengths yet. Height gained is stored per shot, so
that can come later without losing a round.

## What it fills in

- **The card:** strokes and putts from the putter's count.
- **Fairways:** the tee shot's lie, with left or right from the line of play. It is the
  player's own answer that counts if they gave one.
- **Green in regulation** follows from the strokes and putts, as before.
- **The hole:** every shot is drawn on the map, and listed in Hålet.
- **Mina klubbor,** in Meny: each club's typical length and number of shots.

The score the putter writes is said out loud, with Ändra beside it, since a lock can be
missed. A number entered by hand is never overwritten: the card keeps it and says so. A
lock counts on the hole being played, even with another hole on screen. A card left for
over six hours is that day's: the same course played again starts a new round.

## Next

- A club's spread, not only its typical length, and shots drawn as a landing area.
- Per-hole history: how a hole has been played, and from where it is usually lost.
- Shots gained, once there are enough rounds to compare with.
- Taking height and wind out of the lengths with what is already stored.
- A setting for left-handed use, which mirrors the wheel to the other edge.
- Rounds kept off the phone.

## Where it lives

`map-shots.mjs` is the log and its rules, pure and tested. `map-wheel.mjs` is the control:
the browser's own snap scrolling, which gives a flick a phone's true momentum and costs the
map no frames. `map-session.js` joins them to the GPS, the card and the suggestions. Shots
are stored on the phone under `banvy-map-shots-v1`, the newest 6,000, across all courses.

**Not yet proven:** nothing here has been tried on a real course, or on a real phone with a
glove on. The wheel's feel and the 0.9 s hold are the first things to judge there.
