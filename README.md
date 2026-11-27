# Air 2S Drone Simulator

A 3D drone flight simulator for the browser, flown with a real DJI Smart Controller over
Bluetooth. Environments: mountains, city, ocean and beach, with day / night and weather.

The project is built in small numbered steps. So far the aircraft can be flown over a
test field with a landing pad and obstacles, with the keyboard, a gamepad or a flight
stick, with three camera views, a flight display and sound. The other places to fly and
the controller link come in later steps.

## Try it online

https://1rdscorp.github.io/Air-2S-Drone-Simulator/

The site is rebuilt automatically from the `main` branch, so it shows the steps that
have been merged.

## Run it on your computer

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
cd sim
```

```bash
npm ci
```

```bash
npm run dev
```

Then open http://localhost:5173 in Chrome.

## Controls

The aircraft starts on the ground with the motors off. Press **T** to take off: it climbs
to 1.2 m and hovers. Fly with the keys below and press **T** again to land. The line at
the bottom of the screen always says what the aircraft is doing and which key comes next.

The place you fly in is named in the top-right corner. Press **E** (or click the name) for
the list of places; choose one with the arrow keys and Enter, with its number, or with a
click. For now only the **Test Field** is built: flat ground with a grid of 5 m squares, a
landing pad at the start, and things to fly round, between and onto — a cube, a wall, a
30 m tower, a gate, a raised platform and three steps with landing marks, and a row of
poles. Mountains, ocean, beach and city are in the list and are marked "Not built yet".

Obstacles are solid. Flying into one, or coming down too hard, is a **crash**: the aircraft
falls, lies there for three seconds, and is then put back at the start with the motors
off. An ordinary landing is never a crash, because the last metres of a descent are slowed
down however far the stick is pushed; and a light bump or a slow slide along the ground
only stops the aircraft. You can land on anything flat, and the height shown is always the
height above the spot where the motors were started.

There are three camera views; press **V** to change. The chase camera follows from behind,
the drone camera shows what the aircraft's own camera sees, and the free camera can be
moved round the aircraft with the mouse: drag to look around, scroll to zoom.

The drone camera is stabilised like the real one: the horizon stays level however the
aircraft tilts, and only you tilt the camera, with R and F. To let it also look up to 24°
above level, add `?gimbalup=1` to the address.

The flight display shows what a pilot needs while flying:

- **Top left:** flight mode, flight time since the motors started, and the battery
  (always 100 % for now; the battery comes in a later step).
- **Top centre:** a compass with the direction the aircraft faces. The small **H** shows
  in which direction home is; home is the spot where the motors were started.
- **Bottom left:** a horizon that tilts as the aircraft tilts, with an **H** on its rim
  that points to home (top = straight ahead). Next to it: height, distance from home,
  speed over the ground, climb rate and camera tilt.
- **Under the compass:** short messages such as "Taking off" or "Sport mode"; warnings
  are red.

There is sound: the four motors, which rise in a climb or at speed and fall in a descent,
the air rushing past, and short tones for take-off, landing, a change of mode and for
warnings. Browsers only allow sound after a key press or a click, so it starts with your
first one; the label in the top-right corner says whether it is on. Press **M** to switch
it off and on. To start without sound add `?sound=0` to the address, and to make it
quieter add for example `?volume=0.3` (0 to 1).

The stick monitor in the bottom-right corner shows what the simulator reads from your
keyboard or gamepad.

The keyboard acts as two sticks. In stick mode 2, the usual default:

| Key | What it does |
|-----|--------------|
| T | Take off; in the air: land; during a landing: cancel it |
| V | Next camera view: chase, drone camera, free |
| M | Sound off / on |
| J | Set up a flight stick |
| E | The list of places to fly |
| W / S | Left stick up / down: climb / descend |
| A / D | Left stick left / right: turn left / right |
| Arrow up / down | Right stick up / down: fly forward / backward |
| Arrow left / right | Right stick left / right: fly left / right |
| 1 / 2 / 3 | Cine (5 m/s) / Normal (15 m/s) / Sport (19 m/s) mode |
| Space | Flight pause: stops an automatic take-off or landing |
| K | The stick command (both sticks down and inward). On the ground: starts or stops the motors. Held for 2 seconds in the air: cuts the motors, and the aircraft falls and crashes |
| R / F | Tilt the camera up / down, between level and straight down |
| Z | Camera back to level |
| X | Camera straight down |
| H, C, B | Return to home, record, photo (shown, but no effect yet) |

There are two ways to take off and to land, as on the real aircraft:

- **Automatic:** T takes off and T lands. The motors stop by themselves after touchdown.
- **By hand:** K starts the motors, then W lifts off. To land, descend with S until it
  stands on the ground and keep S held for 3 seconds; the motors then stop. Below 7 m the
  descent slows down by itself, to half a metre per second at touchdown.

A standard game controller (Xbox, PlayStation and similar) works too. Press any button on
it once so the browser can see it.

| Gamepad | What it does |
|---------|--------------|
| Left / right stick | The two control sticks |
| Right / left trigger | Tilt the camera up / down |
| D-pad left / up / right | Cine / Normal / Sport mode |
| Start | Take off / land |
| Y, B, X, A | Return to home, flight pause, record, photo |
| Left / right bumper | Camera back to level / camera straight down |

To change which stick does what, add the stick mode to the address:
`?stickmode=1`, `?stickmode=2` or `?stickmode=3`.

### Flight sticks

A flight stick works too, also together with a throttle or pedals (a HOTAS). Plug it in
and press one of its buttons, so the browser can see it. A label in the top-right corner
then says "Flight stick found".

- **Straight away:** the stick flies forward / back and left / right. Climbing and turning
  stay on the keyboard (W / S and A / D), and T takes off. So the right hand flies and the
  left hand rests on the keyboard.
- **Press J to set it up.** The simulator asks for one control at a time, for example
  "Push the stick to the RIGHT and hold it there", and you answer by moving that control.
  Enter skips a control you do not have or do not want; whatever you skip stays on the
  keyboard. At the end it shows the list; Enter saves it, Esc closes without saving.
- **Buttons** on the stick can take off and land, pause the flight, level the camera, point
  it down and choose the flight mode. A hat switch counts as buttons.
- **A throttle lever** that stays where you put it is recognised: its middle then means
  "hold the height", forward of it climbs and behind it descends.
- The setup is remembered in this browser. Press J again to change it.

## Debug tools

| Key | What it does |
|-----|--------------|
| `` ` `` or F2 | Show or hide the debug overlay (frame rate, frame time, draw calls) |
| I | Show or hide the stick monitor |
| P | Pause or resume |
| `.` | One simulation step forward while paused |
| `-` and `=` | Slower or faster |
| Backspace | Put the aircraft back at the start |

The same settings can be put in the address, for example
`http://localhost:5173/?debug=1&paused=1&speed=0.5`. The place to start in can be given
there too: `?env=test` (later also `mountains`, `ocean`, `beach`, `city`).

## Controller check

Before the DJI Smart Controller can be linked, a short test with the real controller has
to show how it can talk to a PC. The steps are in
[docs/CONTROLLER_CHECK.md](docs/CONTROLLER_CHECK.md); the test page is
https://1rdscorp.github.io/Air-2S-Drone-Simulator/controller-check.html. Switch the
aircraft off before you start.

- [Project plan and roadmap](docs/PLAN.md)
- [Prompts for building it step by step](docs/PROMPTS.md)

This is an unofficial hobby project. It is not affiliated with or endorsed by DJI.
"DJI" and "Air 2S" are trademarks of SZ DJI Technology Co., Ltd.
