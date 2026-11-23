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

There is no drone to fly yet (that is Step 05). For now the stick monitor at the bottom of
the screen shows what the simulator reads from your keyboard or gamepad.

The keyboard acts as two sticks. In stick mode 2, the usual default:

| Key | What it does |
|-----|--------------|
| W / S | Left stick up / down: climb / descend |
| A / D | Left stick left / right: turn left / right |
| Arrow up / down | Right stick up / down: fly forward / backward |
| Arrow left / right | Right stick left / right: fly left / right |
| R / F | Gimbal up / down |
| 1 / 2 / 3 | Cine / Normal / Sport mode |
| H | Return to home |
| Space | Flight pause |
| C | Record |
| B | Photo |
| Z / X | Custom buttons C1 / C2 |

A standard game controller (Xbox, PlayStation and similar) works too. Press any button on
it once so the browser can see it.

| Gamepad | What it does |
|---------|--------------|
| Left / right stick | The two control sticks |
| Right / left trigger | Gimbal up / down |
| D-pad left / up / right | Cine / Normal / Sport mode |
| Y, B, X, A | Return to home, flight pause, record, photo |
| Left / right bumper | Custom buttons C1 / C2 |

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

The same settings can be put in the address, for example
`http://localhost:5173/?debug=1&paused=1&speed=0.5`.

- [Project plan and roadmap](docs/PLAN.md)
- [Prompts for building it step by step](docs/PROMPTS.md)

This is an unofficial hobby project. It is not affiliated with or endorsed by DJI.
"DJI" and "Air 2S" are trademarks of SZ DJI Technology Co., Ltd.
