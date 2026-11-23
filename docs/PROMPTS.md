# Prompts

Copy a prompt, change the parts in `[brackets]`, and paste it into a **new** Claude Code
session. One step per session keeps the work small and easy to check.

The step details live in [PLAN.md](PLAN.md), so the prompts stay short.

---

## 1. Master prompt

Claude Code reads `CLAUDE.md` automatically, so you normally do not need this. Use it
when you start with a different AI tool, or when a session seems to have lost the thread.

```text
You are helping me build "Air 2S Drone Simulator": a 3D drone flight simulator that runs
in Chrome and is flown with a real DJI Smart Controller connected over Bluetooth.

Before you do anything, read CLAUDE.md and docs/PLAN.md in this repository. They hold the
decisions already made and the numbered roadmap:
- a TypeScript + Three.js web app in sim/
- a small Android bridge app for the controller in rc-bridge/
- four procedural environments (mountains, city, ocean, beach) with day/night and weather
- our own fixed-timestep flight model using published Air 2S numbers

How we work:
- The project is built in small numbered steps. Do one step per session, and only the
  step I name. I am not a full-time developer, so I check your work by trying it and by
  looking at screenshots, not by reading every line of code.
- Follow the decisions in the plan. If you think one is wrong, tell me why and what you
  would do instead before you change it.
- Every step must end in a working app: tests pass, the app starts, and you show me
  screenshots of what changed.
- Tell me plainly what you could not verify. Anything that needs the real controller is
  my job to test; give me a short checklist for it.
- Use original 3D models and screen design. No DJI logos, artwork or copied screens.

Start by telling me which steps are ticked in docs/PLAN.md and what the next step is.
Do not write code yet.
```

---

## 2. Step prompt (the one you will use most)

```text
Read CLAUDE.md and docs/PLAN.md, then build Step [NN] only.

1. First tell me in a few lines: the goal of this step, its "done when" list, and the
   files you plan to add or change. If something in the step is unclear or depends on a
   decision I have not made, ask me before you build.
2. Build it. Stay inside this step. If you notice work that belongs to a later step,
   leave a short TODO(step-XX) comment instead of doing it now.
3. Prove it works: run lint, type-check, unit tests and the smoke test, then start the
   app in headless Chromium and take screenshots of what changed. Show me the screenshots.
4. Update docs/PLAN.md: tick the step and add a line to the decision log for anything you
   decided or changed. Update CLAUDE.md if commands or folders changed.
5. Commit as "step [NN]: [title]", push, and open a pull request into main.

Then stop and tell me: what you built, how I can try it myself, what you could not
verify, and anything I should decide before the next step.
```

Extra lines you can add to the step prompt when they apply:

- For a step with hardware (04, 22, 23, 24, 25):
  `My controller is the [DJI Smart Controller RM500]. My computer is [Windows 11 with Chrome]. Give me a numbered test checklist I can follow with the drone switched off.`
- For an environment step (12, 14, 15, 16):
  `The look I want: [for example: Alps in summer, green valleys, snow above 2500 m].`
- For a step you want to preview before it is built:
  `Do part 1 only and wait for my answer.`

---

## 3. Hardware report prompt

Use after you have run a hardware checklist (Steps 04, 22–25).

```text
Here are my results for the Step [NN] hardware checklist.

Controller model: [DJI Smart Controller RM500]
Computer and browser: [Windows 11, Chrome]
Drone: switched off

Results:
1. [PASS / FAIL — what I saw]
2. [PASS / FAIL — what I saw]
3. [PASS / FAIL — what I saw]

[Paste the report text from the app, or attach photos of the screen.]

Read docs/PLAN.md section 3. Tell me what these results mean, which link from the
fallback ladder we should use, and write that decision in the decision log. Do not start
the next step yet.
```

---

## 4. Fix prompt

```text
Something is wrong after Step [NN].

What I did: [steps to repeat it]
What I expected: [...]
What happened: [...]
[Attach a screenshot or screen recording. Paste any red text from the browser console.]

First repeat the problem yourself and tell me the cause. Then fix only this problem, add
a test that would have caught it, show me a before/after screenshot, commit and push.
```

---

## 5. Flight-feel tuning prompt

```text
The drone does not feel right in [Normal] mode compared with my real Air 2S:
[for example: it stops too suddenly when I release the stick / it turns too fast /
it feels floaty when I descend].

Change only the numbers in the Air 2S config file. The tests for published values (top
speed, climb, descent, yaw rate) must still pass. Tell me which numbers you changed, from
what to what, and why. Give me two variants to compare if you are not sure.
```

---

## 6. Milestone review prompt

Use after the last step of each milestone.

```text
Milestone [N] is finished. Review the code written in this milestone; add no new features.

Check: dead or duplicated code, anything that breaks the module contracts in
docs/PLAN.md section 4, missing tests for risky logic, memory that is not freed when the
environment changes, and frame rate in each environment against the targets.

Give me a short list ordered by importance, with what you recommend for each. Fix the
ones that are clearly safe, and ask me about the rest.
```

---

## 7. "Where are we?" prompt

```text
Read docs/PLAN.md and the git history. Tell me in a short list: which steps are done,
which step is next, any open questions in the decision log, and anything I need to
prepare for the next step (accounts, hardware, decisions).
```

---

## Tips

- Start a new session for every step. Long sessions drift.
- Try the result yourself before you merge. A screenshot from the assistant shows that
  it renders; only you can say whether it feels right.
- Attach pictures and recordings to your prompts; they say more than descriptions.
- If a step turns out too big, ask: `Split Step [NN] into two or three smaller steps and update docs/PLAN.md. Do not build yet.`
- Keep the drone switched off whenever the bridge app is used.
