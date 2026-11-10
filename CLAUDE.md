# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Orbit AI: a small 3D robot (Electron + Three.js) living on the Windows desktop in a transparent, click-through,
always-on-top window. You talk to it by voice through the Gemini Live API. It roams, has moods and skins, does
stunts, transforms into the "AeroStrike" mech (with a defence mode), opens apps/websites, and watches AI coding
agents (alerts + Allow/Deny cards for their permission requests). Windows only.

## Commands

```bash
npm start                                  # run the app (electron .)
npm test                                   # all tests (node:test, files in test/)
node --test test/flip.test.mjs             # one test file
node --test --test-name-pattern "kick" test/defend.test.mjs   # one test by name
npm run format                             # Prettier (singleQuote, printWidth 120)
npm run format:check                       # what CI-style checking expects to pass
npm run dist                               # Windows installer via electron-builder
blender -b -P tools/aerostrike.py          # rebuild the AeroStrike model → renderer/models/aerostrike.glb.js
blender -b -P tools/aerostrike.py -- --blend   # …and also save tools/aerostrike.blend (gitignored)
```

Tests import renderer ES modules from `.mjs` files and main-process CommonJS modules from `.js` files. Only pure
modules are tested; anything needing Electron or WebGL is checked by running the app.

## Architecture

**Two processes, one brain.** `main.js` (Electron main) owns the windows, menu, IPC, config and the agent listener.
`brain.js` also runs in main: a 60 Hz `tick()` that decides everything about behaviour (roaming, dodging the mouse,
naps, daily rhythm, moods via `mood.js`, stunt timing, transformation progress, defence flag) and moves the window
with `setBounds` (never `setPosition`: it grows the window on scaled displays). It sends a `motion` message to the
renderer every tick; the renderer mostly _draws_ that state. Click-through is decided in the brain too:
`setIgnoreMouseEvents` toggles on a hit ellipse taken from the current layout in `form.js` (Orbit 200×230 vs. the
grown/mech 240×280 window, which keeps the robot on the same spot via `moveFor`; AeroStrike is drawn to the window height, so that size is its on-screen size).

**Renderer** (`renderer/`, plain ES modules, no bundler): `app.js` wires everything — Gemini Live session
(`gemini.js`, a WebSocket opened directly from the renderer), mic/speaker (`audio.js` + `pcm-worklet.js`, 16 kHz
in / 24 kHz out), Gemini tool calls (`open_app`, `open_website`, `do_trick`, `transform`, `defence_mode`,
`change_skin`, `agent_status`, and `browser_*` when browser control is on), captions, and agent alerts (one at a
time, only while idle, on a second `Player`; spoken by Kokoro via `voice.js` in main once downloaded, else the
Windows voice). `preload.js` is the only bridge (`window.orbit`, contextIsolation on); renderer code can't use Node.
Settings, the subtitle bubble and the agent chat are separate windows (`renderer/settings.*`, `renderer/bubble.*`,
`renderer/chat.*`) sharing the same preload. The bubble is never focused and is click-through except while the mouse
is over it (`bubble:hover` toggles `setIgnoreMouseEvents`); main moves it with the robot, and a waiting request
always takes it over.

**Polite flying.** `typing-watch.js` runs one hidden PowerShell (C# via `Add-Type`) that prints the last-input tick,
the system caret and, without a caret, the focused text field (UI Automation), every 150 ms. `avoid.js` (pure) counts
input without mouse movement as typing, turns the caret/field into a zone, and the brain pushes the robot's hit
ellipse out of it, steers around the pointer while flying, and stops avoiding once the pointer rests on it (catch).

**Browser control.** `browser.js` (main) drives Edge/Chrome/Brave (paths from `actions.BROWSERS`) through
`playwright-core` with a separate profile in userData. Elements are found by role + name from `ariaSnapshot()`;
`browser-rules.js` (pure) refuses secret fields and flags risky clicks/submits, which wait on `askConfirm` — the same
card window as agent approvals, resolved through a promise instead of an HTTP response.

**3D robot.** `robot.js` builds the scene and runs the frame loop (frame cap: 60 fps only while moving/talking/
morphing/defending, 30 idle, 12 asleep). `mech.js` builds AeroStrike: each part registers a deployed pose plus a
stowed pose and a time slot, `setMorph(p)` interpolates them (0 = Orbit, 1 = mech; Orbit's body becomes the chest
core), and `update()` layers idle life, stunt limbs and defence limbs on top. The detailed meshes come from the
Blender script: the GLB is embedded as base64 in `renderer/models/aerostrike.glb.js`, and at load each named Blender
object replaces the children of the same-named group in `mech.js` (names must not contain `.`; children marked
`userData.keep` survive the swap). Motion math lives in pure, tested modules: `flip.js` (stunts done like a person:
angular momentum, tuck) and `defend.js` (block/kick/laser poses with flinch, counter-balance and a damped recoil
spring). `robot.js` applies the whole-body part of a pose (turn, lean, lift), `mech.js` the limbs. Sounds are
synthesised with WebAudio in `sfx.js` (no audio files). Jet flames (`jet.js`: shader cones + a `Points` exhaust in
world space) are driven by one shared engine state in `robot.js` (`jetPhysics.js`: spool lag, drag, buoyancy); the
exhaust is shifted by the window's own velocity each frame so it trails on the desktop.

**Values that must stay in sync across files:** `TRANSFORM_SECS` (form.js) ↔ `SECS` (sfx.js); `easeInOut`
(brain.js) ↔ flip.js (the loop flies the window and turns the body on the same curve); `SKIN_LABELS` (main.js) ↔
`TRANSFORM_SECS` (form.js ↔ renderer/sfx.js `SECS`, 4.4 s; the step slots are `STEPS` in renderer/mech.js and the
wind-up/ignition bumps in robot.js follow them); `SKIN_NAMES` (robot.js); `depthScale` (flight.js ↔ renderer/heading.js: the brain's hit area and the drawn
size must agree); `DEFENCE_SECS` (defend.js) is used by app.js, robot.js and sfx.js timings.

**Flight attitude.** `robot.js` wraps the robot in a `flight` group (Euler order YXZ) that `heading.js` turns toward
the 3D velocity from the brain (screen vx/vy plus AeroStrike's depth speed `vz`), and scales by `depthScale(depth)`.
Stunt/defence poses rotate `root` inside it; the group faces the camera whenever those run or Orbit is talking.

**Follow-through.** `renderer/joints.js` gives every joint (spine, neck, shoulders, elbows, wrists, hips, knees,
wings, feather tips, Orbit's antennas) its own damped spring, kicked by velocity changes in `robot.setMotion` (turned
into the robot's frame by the attitude yaw). `robot.js` leans the spine on `root`; `mech.js` `follow()` applies each
limb segment relative to its parent. Hands are their own pivots (`handR`/`handL`) with chained phalanges
`hand<R|L>F<finger><joint>` from the Blender model, curled by quaternion from their rest pose; wing feathers are
`<wing>F0..F5`, matching `FEATHERS` in mech.js.

**Postures and face cards.** `renderer/postures.js` returns additive joint angles (stance, taunt, sleep), blended in
`robot.js` and applied by mech.js `hold()` after the follow-through; a posture's `grip` overrides the resting hand
shape. AeroStrike now naps as itself (brain.js no longer folds it to Orbit). `renderer/faceCard.js` draws cards
(agent icon, emoji, text) on the face canvas; `robot.showCard(card, secs)` takes over `#drawFace` until it expires.

**Transparent window gotcha:** glow sprites use `lightBlend`, which adds colour but never writes alpha, so it is
invisible over empty (transparent) parts of the window. Anything that must show over the desktop (e.g. the laser
beam) needs normal alpha blending.

**Three.js is vendored** in `renderer/vendor/` (the renderer can't import from `node_modules`); `GLTFLoader.js` and
`BufferGeometryUtils.js` have their imports patched to the local `./three.module.min.js`. Vendor and model files are
excluded from Prettier.

## Agent watching and safety (main.js + agent-watch.js)

- Agents reach Orbit on `http://127.0.0.1:47873` with a random token in the URL: Claude Code via `http` hooks in
  `~/.claude/settings.json`; Codex/Copilot/Antigravity/Hermes via the generated bridge script
  `%APPDATA%\orbit-ai\orbit-hook.ps1`; OpenCode via a plugin file. `agent-watch.js` is pure: it normalises each
  agent's payload to one Claude-style event, turns events into alerts, hides secrets (`hideSecrets`), and builds the
  hook entries. Orbit only ever adds/removes its own entries, keeps a one-time `.orbit-backup`, refuses to touch a
  file it can't parse, and writes atomically (`editConfig` / `writeAtomic`, which retries Windows EPERM/EBUSY).
- Requests (`pending` in main: `addRequest` / `settleApproval`): an agent's PermissionRequest (held HTTP response),
  Claude's AskUserQuestion (answered with `answerInput` → `updatedInput.answers`), an MCP `ask_user` call, or a
  browser confirm (promises). The oldest shows in the bubble; the chat shows its session's with the whole input.
  Only the bubble and chat windows may decide (`claude:decide` checks the sender) — Gemini/voice never can.
  `approvalDetail` marks a request `partial` (cut off, secret hidden, or unseen fields like a Write's content):
  no Allow from the bubble; from the chat only if nothing was hidden as a secret. Deny can carry your message.
- Replies to a working agent wait in its session's `inbox` (agent-watch `Watch`) and are delivered by the Stop hook
  (`stopReply` → `decision: "block"`) or MCP `check_messages`. Orbit's MCP server (`mcp.js`, served at
  `/mcp/<token>`) is registered once with `claude mcp add --scope user` (config flag `claudeMcp`).
- The chat reads the agent's transcript (`transcript_path` from hook events; only `.jsonl` under the home folder,
  tail only) while open; `transcriptMessages` parses Claude Code's and Codex's formats.
- `actions.js` is the only way voice opens things: model text only _selects_ a fixed app entry or Start-menu AppID
  and http(s) URLs are passed as a single argv entry — never through a shell. `test/actions.test.js` guards this.

## Config

`%APPDATA%\orbit-ai\config.json`; the API key is encrypted with `safeStorage` (DPAPI). `loadConfig()` merges
`DEFAULTS` and falls back to `GEMINI_API_KEY`; `saveConfig(partial)` starts from the stored file and only touches
the key when a new `apiKey` is passed (a key from the env var is never written). Chat logs go to
`%APPDATA%\orbit-ai\logs`.

## Packaging

`package.json` → `build.files` lists the main-process files explicitly (`renderer/**/*` is included wholesale): a
new root-level module must be added there or the installed app won't find it. `onnxruntime-node` (Kokoro) is in
`asarUnpack` because native modules can't load from the asar. Keep the README's project-layout table in step with
new files.

**Offline models run in `models-host.js`**, a utilityProcess started by main.js (`modelHost.call('voice.speak' | 'wake.hear' | '*.load')`): running Kokoro or Whisper in the main process froze hook replies and bubbles for 15–20 s at a time. main.js keeps voice.js/wake.js only for the cheap `downloaded()` checks. The alert bubble is shown before the speech is synthesized, then re-timed.

**Wake word.** `wake.js` runs Whisper tiny.en via `@huggingface/transformers` on
short clips cut by `renderer/wakeword.js` (energy-based segmenter, `isWake`); the wake mic only runs while idle and
`cfg.activation` is `wake`/`both`, and the hotkey isn't registered for `wake`. Both offline models read from
`userData/models` with `env.localModelPath` + `allowLocalModels` (allowRemoteModels only for the Settings download).
**Float-target gotcha (for any future post-processing):** `pow()` of a negative base is NaN in GLSL; on screen NaN
clamps to black/transparent, but in a float render target it survives and spreads. Clamp every `pow` base.

**Ambush and dictation.** `ambush.js` (pure) decides when AeroStrike fires across the screen; brain.js calls
`onAmbush({x0,y0,x1,y1})` (screen px), main.js shows a click-through overlay window (`renderer/laser.*`, 2D canvas
beam) over the robot's display and tells the robot page to pose (`robot.defend('laser', nx, ny, true)`: the in-window
beam is hidden for long shots). Dictation: Gemini's `type_text` tool -> IPC `type:text` -> clipboard + SendKeys ^v,
clipboard restored; the robot window is `focusable: false` so clicking it never takes the focus off your text box.

**Teleport.** `teleport.js` (pure) decides when (`SHARE` of long journeys in `decide`, `shouldEscape` in the dodge
block) and where (`pickDestination` via avoid.goodSpot, `escapeSpot`). brain.js runs mode `teleport`: holds still,
jumps the window at `JUMP` (0.5) of `TELEPORT_SECS[form]`, then rests; the motion payload carries
`tele: { p, dx, dy }`. robot.js applies `renderer/warp.js` `warpPose(p, form)` to `root` (scale/visibility along the
jump direction, jets via `lift`, the `warpRing` shockwave for the mech) and resets root scale/visible every frame.
The laser overlay draws the desktop streak (`kind: 'streak'` on the `ambush` channel); sfx.js `playTeleport`.
