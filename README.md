# Air 2S Drone Simulator

A 3D drone flight simulator for the browser, flown with a real DJI Smart Controller over
Bluetooth. Environments: mountains, city, ocean and beach, with day / night and weather.

The project is built in small numbered steps. So far it shows a first lit 3D scene; the
drone, the environments and the controller link come in later steps.

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

There are three camera views; press **V** to change. The chase camera follows from behind,
the drone camera shows what the aircraft's own camera sees, and the free camera can be
moved round the aircraft with the mouse: drag to look around, scroll to zoom.

The drone camera is stabilised like the real one: the horizon stays level however the
aircraft tilts, and only you tilt the camera, with R and F. To let it also look up to 24°
above level, add `?gimbalup=1` to the address.

The stick monitor in the bottom-right corner shows what the simulator reads from your
keyboard or gamepad.

The keyboard acts as two sticks. In stick mode 2, the usual default:

| Key | What it does |
|-----|--------------|
| T | Take off; in the air: land; during a landing: cancel it |
| V | Next camera view: chase, drone camera, free |
| W / S | Left stick up / down: climb / descend |
| A / D | Left stick left / right: turn left / right |
| Arrow up / down | Right stick up / down: fly forward / backward |
| Arrow left / right | Right stick left / right: fly left / right |
| 1 / 2 / 3 | Cine (5 m/s) / Normal (15 m/s) / Sport (19 m/s) mode |
| Space | Flight pause: stops an automatic take-off or landing |
| K | The stick command (both sticks down and inward). On the ground: starts or stops the motors. Held for 2 seconds in the air: cuts the motors, and the aircraft falls |
| R / F | Tilt the camera up / down, between level and straight down |
| Z | Camera back to level |
| X | Camera straight down |
| H, C, B | Return to home, record, photo (shown, but no effect yet) |

There are two ways to take off and to land, as on the real aircraft:

- **Automatic:** T takes off and T lands. The motors stop by themselves after touchdown.
- **By hand:** K starts the motors, then W lifts off. To land, descend with S until it
  stands on the ground and keep S held for 3 seconds; the motors then stop.

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
`http://localhost:5173/?debug=1&paused=1&speed=0.5`.

- [Project plan and roadmap](docs/PLAN.md)
- [Prompts for building it step by step](docs/PROMPTS.md)

This is an unofficial hobby project. It is not affiliated with or endorsed by DJI.
"DJI" and "Air 2S" are trademarks of SZ DJI Technology Co., Ltd.
