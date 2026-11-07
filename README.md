# Orbit AI

**A tiny 3D robot that lives on your Windows desktop and talks with you.**

![Orbit flying from corner to corner across a desktop](docs/flying.gif)

Orbit floats over your other windows, flies around on its own, dodges your mouse and takes naps.
Click it, ask anything out loud, and it answers with a real voice using Google's Gemini Live API.
It speaks **99 languages** (including English and Tamil), opens any app on your PC by voice, and does flying stunts.

> Free and open source (MIT). You bring your own free Gemini API key.

## Features

![Orbit's moods: idle, listening, speaking and napping](docs/screenshot.png)

- **Voice chat**: push-to-talk. Click the robot (or press **Ctrl+Space**), speak, click again. Orbit answers out loud,
  with live captions.
- **99 languages**: every language the Gemini Live API supports. Pick the one or two you speak in Settings (for
  example Tamil + English, mixed "Tanglish" too) and Orbit replies only in those, even when speech recognition
  mis-hears you as a similar-sounding language. Auto mode follows the conversation without any setup.
- **A robot with a life of its own**: a small Three.js robot with a glowing face that listens, thinks, talks, gets
  surprised and falls asleep.
- **Daily routine**: it roams the screen, goes on little journeys, flinches away from a fast mouse but lets you approach
  slowly, naps when nobody talks to it, and is calmer at night.
- **Flying stunts**: spins, backflips, barrel rolls and loop-the-loops. It shows off on its own after a journey (more in
  the morning, never at night), when you ask ("do a backflip!"), or from right-click → Do a trick.
- **Opens your apps by voice**: Orbit finds the apps in your Start menu automatically, so "open Blender" or "open
  Spotify" just works. It also opens websites: "open YouTube", "search for biryani recipes".
- **Five skins**: Metallic, Leather, Matte, Velvet and a holographic Crazy skin (see below).
- **Your choice of voice and devices**: 30 Gemini voices, pick your microphone and speaker in Settings.
- **Private by design**: your API key is stored encrypted on your PC, and chat logs never leave it.

### Skins

![Orbit in its five skins: Metallic, Leather, Matte, Velvet and Crazy](docs/skins.png)

| Skin     | Look                                                                    |
| -------- | ----------------------------------------------------------------------- |
| Metallic | Brushed silver with graphite trim (default)                             |
| Leather  | Saddle-brown pebbled leather, cream stitching, brass trim               |
| Matte    | Soft off-white with no shine, like a designer vinyl toy                 |
| Velvet   | Deep plum with a soft pink velvet sheen, gold trim                      |
| Crazy    | Holographic rainbow that slowly slides round the body; idle glow cycles |

Change it from right-click → **Skin**, in Settings, or just ask: "wear your velvet skin".

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 20 or newer
- A microphone
- A Gemini API key. It's free to get one at [Google AI Studio](https://aistudio.google.com/apikey).

## Install and run

```bash
git clone https://github.com/Quantumdrift21/orbit-ai.git
cd orbit-ai
npm install
npm start
```

On first launch the Settings window opens. Paste your Gemini API key and press Save.
You can also set the `GEMINI_API_KEY` environment variable instead.

### Build a Windows installer

```bash
npm run dist
```

The setup `.exe` lands in `dist/`. It is not code-signed, so Windows SmartScreen may warn you the first time you run it
("More info" → "Run anyway").

## How to use

| Action                     | What it does                                    |
| -------------------------- | ----------------------------------------------- |
| Click robot / Ctrl+Space   | Start listening, click again to send            |
| Click while it is speaking | Interrupt and ask something new                 |
| Drag the robot             | Move it anywhere                                |
| Right-click the robot      | Settings, logs, roam, nap, tricks, skin, on top |

Everything around the robot is click-through, so it never blocks the windows under it.

### Things you can ask

- "What's the weather like in Chennai usually in December?"
- "இன்னைக்கு என்ன சமைக்கலாம்?" (What can I cook today?)
- "Open YouTube and search for lo-fi music"
- "Open Blender" / "Open Calculator"
- "Do a backflip!" / "Show me a loop-the-loop"
- "Wear your leather skin" / "Go crazy!"

**Apps it can open:** anything in your Start menu (found automatically, refresh with Settings → Rescan), plus Chrome,
Edge, Brave, Notepad, Calculator, File Explorer, Paint, Settings, Task Manager, Command Prompt, VS Code, Spotify,
WhatsApp, Steam, OBS Studio, VLC, Camera and Photos. If a name fits several apps ("Visual Studio"), Orbit asks which one.
For safety it never opens uninstallers, PowerShell, Registry Editor or Recovery Drive. If the browser you ask for is
missing, it uses your default browser and tells you.

## Settings

Right-click the robot → **Settings…**

| Setting       | Notes                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| API key       | Stored encrypted with Windows DPAPI                                                 |
| Model         | Default `gemini-3.8-live`; any Gemini Live model name works                         |
| Voice         | 30 Gemini voices                                                                    |
| Skin          | Metallic, Leather, Matte, Velvet or Crazy                                           |
| Languages     | Main + optional second language (any of 99), or Auto. Picking them is most reliable |
| Apps by voice | Find Start-menu apps automatically (on by default), with a Rescan link              |
| Microphone    | With a live level meter. Virtual mics (Camo, VB-Cable, OBS…) are skipped by default |
| Speaker       | With a test chime                                                                   |
| Hotkey        | Default Ctrl+Space                                                                  |
| System prompt | Change Orbit's personality                                                          |

## Privacy

- **Your API key** is saved only on your PC, encrypted, in `%APPDATA%\orbit-ai\config.json`. It is never in this
  repository and never sent anywhere except to Google's Gemini API.
- **Your voice** is sent to Google only while Orbit is listening (after you click). It is not always listening.
- **Your list of installed apps** never leaves your PC. Gemini only gets the app name you say, and Orbit matches it
  locally.
- **Chat logs** (text transcripts) are saved only on your PC in `%APPDATA%\orbit-ai\logs`. Open them from the
  right-click menu, delete them any time.
- Your conversations are handled by Google under the [Gemini API terms](https://ai.google.dev/gemini-api/terms). On the
  free tier, Google may use your data to improve its products.

## Troubleshooting

- **"No sound from …"**: Orbit picked a silent microphone. Right-click → Settings → Microphone, and watch the level
  meter move while you speak.
- **It says "Right-click → Settings to add API key"**: no key is saved yet.
- **It replies in the wrong language** (e.g. Hindi when you spoke Tamil): speech recognition mis-heard you as a
  similar-sounding language. Set your Main and Second language in Settings instead of Auto.
- **Can't find the robot**: press Ctrl+Space, its status text appears. It has no taskbar icon on purpose.

## Project layout

| File                                  | What it does                                                         |
| ------------------------------------- | -------------------------------------------------------------------- |
| `main.js`                             | Windows, hotkey, menu, settings storage (encrypted key)              |
| `brain.js`                            | Roaming, mouse dodging, naps, daily routine, click-through           |
| `actions.js`                          | The apps and websites Gemini may open, with safety checks            |
| `preload.js`                          | The small, safe bridge between the window and the main process       |
| `renderer/app.js`                     | Listen → think → speak state machine                                 |
| `renderer/robot.js`                   | The 3D robot (Three.js) and its animations                           |
| `renderer/gemini.js`                  | Gemini Live WebSocket client                                         |
| `renderer/audio.js`, `pcm-worklet.js` | Microphone capture and voice playback                                |
| `renderer/settings.*`                 | Settings window                                                      |
| `renderer/languages.js`               | The 99 Gemini Live languages and the reply-language rules            |
| `renderer/preview.html`               | Try the robot's moods and tricks in a browser (`npx serve renderer`) |

## Contributing

Issues and pull requests are welcome. Before you open a PR:

```bash
npm test
npm run format:check
```

`npm test` checks the safety rules for opening apps and websites, so please keep it passing.

## License

[MIT](LICENSE). Three.js is bundled under its own MIT license (`renderer/vendor/three.LICENSE.txt`).
