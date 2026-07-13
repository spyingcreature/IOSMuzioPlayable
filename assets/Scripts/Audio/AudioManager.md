# AudioManager (Cocos 3.8.8)

Centralized audio playback component for inspector-driven clip lookup by key. Supports:

- music playback with optional crossfade
- one-shot overlapping SFX
- controllable looping SFX with dynamic pooled AudioSources
- direct method calls and app-event triggers

**Script:** `assets/Scripts/Audio/AudioManager.ts`  
**Component name in editor:** `AudioManager`

## Inspector setup

1. Create an `AudioManager` node in your scene.
2. Add at least two `AudioSource` components:
   - one for music (`musicSource`)
   - one for one-shot SFX (`sfxSource`)
3. For music crossfade, add a third source and assign `secondaryMusicSource`.
4. Add `AudioManager`.
5. Assign key/clip pairs:
   - `musicKeys` + `musicClips` (same indexes)
   - `sfxKeys` + `sfxClips` (same indexes)
6. Optional:
   - `defaultMusicVolume`, `defaultMusicLoop`, `defaultMusicFadeDuration`
   - `defaultSfxVolume`
   - `maxLoopingSfxSources`
   - event names (`audio:music`, `audio:fadeMusic`, `audio:sfx`, `audio:sfxLoop`, `audio:stopSfxLoop`, `audio:stopAllSfxLoops`, `audio:stopMusic`, `audio:stopAll`)
   - `debugLogs`

## Key and pool rules

- Keys are matched by exact trimmed string.
- Key arrays and clip arrays are index-paired.
- Duplicate keys are skipped.
- Missing keys log warnings when called.
- One-shot and looping SFX share the same `sfxKeys`/`sfxClips` lookup.
- Looping SFX creates `AudioSource` components dynamically only when needed, under `__LoopingSfxSources`.

## Public API

- `rebuildClipMaps(): void`
- `playMusic(key: string, volume?: number, loop?: boolean): boolean`
- `fadeToMusic(key: string, duration?: number, volume?: number, loop?: boolean): boolean`
- `stopMusicFade(duration?: number): void`
- `isMusicFading(): boolean`
- `stopMusic(): void`
- `pauseMusic(): void`
- `resumeMusic(): void`
- `setMusicVolume(volume: number): void`
- `playSfx(key: string, volume?: number): boolean`
- `playLoopingSfx(key: string, loopId?: string, volume?: number): boolean`
- `stopLoopingSfx(loopIdOrKey: string): void`
- `stopAllLoopingSfx(): void`
- `isLoopingSfxPlaying(loopIdOrKey: string): boolean`
- `stopAllSfx(): void`
- `stopAll(): void`

## ScenarioManager `call` examples

Play SFX by key:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "playSfx",
  "args": ["buttonClick", 1]
}
```

Play music by key:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "playMusic",
  "args": ["mainTheme", 0.8, true]
}
```

Fade to music by key:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "fadeToMusic",
  "args": ["mainTheme", 0.75, 0.8, true]
}
```

Start looping SFX:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "playLoopingSfx",
  "args": ["engineLoop", "trainEngine", 0.7]
}
```

Stop specific looping SFX:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "stopLoopingSfx",
  "args": ["trainEngine"]
}
```

Stop everything:

```json
{
  "type": "call",
  "target": "audioManager",
  "component": "AudioManager",
  "method": "stopAll",
  "args": []
}
```

## App event examples

Play music (immediate):

```json
{
  "type": "fire",
  "event": "audio:music",
  "data": { "key": "mainTheme", "volume": 0.8, "loop": true }
}
```

Play music with fade using the same `audio:music` event:

```json
{
  "type": "fire",
  "event": "audio:music",
  "data": { "key": "mainTheme", "volume": 0.8, "loop": true, "fadeDuration": 0.75 }
}
```

Always-fade route:

```json
{
  "type": "fire",
  "event": "audio:fadeMusic",
  "data": { "key": "mainTheme", "volume": 0.8, "loop": true, "fadeDuration": 0.75 }
}
```

Play one-shot SFX:

```json
{
  "type": "fire",
  "event": "audio:sfx",
  "data": { "key": "buttonClick", "volume": 1 }
}
```

Play looping SFX:

```json
{
  "type": "fire",
  "event": "audio:sfxLoop",
  "data": { "key": "engineLoop", "loopId": "trainEngine", "volume": 0.7 }
}
```

Stop specific looping SFX:

```json
{
  "type": "fire",
  "event": "audio:stopSfxLoop",
  "data": "trainEngine"
}
```

Stop all looping SFX:

```json
{
  "type": "fire",
  "event": "audio:stopAllSfxLoops"
}
```

Stop music and all audio:

```json
{
  "type": "fire",
  "event": "audio:stopMusic"
}
```

```json
{
  "type": "fire",
  "event": "audio:stopAll"
}
```

## Direct event API examples

```ts
ScenarioManager.events.emit('audio:sfx', 'buttonClick');
ScenarioManager.events.emit('audio:music', { key: 'mainTheme', volume: 0.8, loop: true, fadeDuration: 0.75 });
ScenarioManager.events.emit('audio:sfxLoop', { key: 'engineLoop', loopId: 'trainEngine', volume: 0.7 });
ScenarioManager.events.emit('audio:stopSfxLoop', 'trainEngine');
ScenarioManager.events.emit('audio:stopAllSfxLoops');
ScenarioManager.events.emit('audio:stopMusic');
ScenarioManager.events.emit('audio:stopAll');
```
