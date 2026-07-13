# ScenarioManager (Cocos 3.8.8)

Data-driven scenario runner for playable ads and scripted sequences. Steps run as ordered timelines made of actions (move, wait, enable nodes, call component methods, play audio, etc.).

**Script:** `assets/Scripts/Scenario/ScenarioManager_Cocos388.ts`  
**Component name in editor:** `ScenarioManager`

Inspired by PlayCanvas-style scenario JSON, with a global event bus for advancing steps from UI or other scripts.

---

## Setup

1. Add `ScenarioManager` to a node in your scene (e.g. `GameManager`).
2. Fill **Entity Keys** and **Entity Refs** with matching indexes for nodes you want to reference by name in actions.
3. Define your scenario in one of two ways:
   - **Steps Json** — paste a JSON array into the inspector field, or
   - **buildScenario()** — edit the method in code (used when `stepsJson` is empty or invalid).
4. Enable **Auto Start** to run on scene load, or call `startScenario()` manually.

Example entity setup:

| Entity Keys | Entity Refs |
|---|---|
| `train` | Locomotive node |
| `cameraController` | Camera rig with `ScenarioCameraController` |
| `tapHint` | Tap hint UI node |
| `ctaButton` | CTA button node |

---

## Inspector properties

| Property | Default | Description |
|---|---|---|
| `autoStart` | `true` | Start scenario automatically in `start()` |
| `startDelay` | `0` | Seconds to wait before auto start |
| `debugLogs` | `false` | Log step/action execution to console |
| `stopOnActionError` | `true` | Stop scenario if an action throws or rejects |
| `entityKeys` | `[]` | String keys for named targets |
| `entityRefs` | `[]` | Nodes matching `entityKeys` indexes |
| `stepsJson` | `''` | JSON scenario array; falls back to `buildScenario()` |

---

## Scenario structure

A scenario is an **array of steps**. Each step contains actions and controls how the scenario advances.

```typescript
interface ScenarioStep {
    id?: string;           // Optional name for gotoStep()
    mode?: 'sequence' | 'parallel';  // How actions inside the step run
    next?: 'auto' | 'wait'; // Advance automatically or wait for nextScenario()
    actions?: ScenarioAction[];
}
```

```typescript
interface ScenarioAction {
    type: string;
    target?: string | number | Node;

    value?: boolean;
    duration?: number;
    easing?: string;
    to?: number[];         // [x, y, z]
    event?: string;
    data?: unknown;

    actions?: ScenarioAction[];  // For nested sequence/parallel

    component?: string;
    script?: string;       // Alias for component (PlayCanvas compat)
    method?: string;
    args?: unknown[];

    index?: number;        // AudioSource index
}
```

### Step modes

| `mode` | Behavior |
|---|---|
| `sequence` | Actions run one after another (default) |
| `parallel` | All actions start at the same time; step finishes when all complete |

### Step advance (`next`)

| `next` | Behavior |
|---|---|
| `auto` | After the step finishes, automatically runs the next step (default) |
| `wait` | Pauses until `nextScenario()` is called (button tap, event, etc.) |

Nested groups are also supported using action types `sequence` or `parallel` with an `actions` array.

---

## Target resolution

Action `target` fields resolve in this order:

1. **Entity key** — e.g. `"train"` from `entityKeys/entityRefs`
2. **Numeric index** — e.g. `0` → `entityRefs[0]`
3. **Numeric string** — e.g. `"0"` → `entityRefs[0]`
4. **Hierarchy path** — e.g. `"Canvas/HUD/CTAButton"` via `find()`
5. **Node name search** — recursive search by name in the scene

In `call` action args, resolve entity references with:

```json
{ "$node": "train" }
```

or

```json
{ "$entity": "train" }
```

---

## Built-in actions

### `enable`

Show or hide a node.

```json
{ "type": "enable", "target": "tapHint", "value": true }
{ "type": "enable", "target": "tapHint", "value": false }
```

### `wait`

Pause for a duration (seconds). Returns a Promise; blocks in sequence mode.

```json
{ "type": "wait", "duration": 1.5 }
```

### `waitNext`

Pause until `nextScenario()` is called. Useful inside a step's action list.

```json
{ "type": "waitNext" }
```

### `waitEvent`

Pause until an event is received. Works inside action sequences and nested action groups.

- Without `target`, it listens on `ScenarioManager.events`.
- With `target`, it listens on that node's `node.emit(...)` events.

```json
{ "type": "waitEvent", "event": "scenario:next" }
{ "type": "waitEvent", "target": "holdArea", "event": "hold-leave" }
```

### `moveTo`

Tween world position.

```json
{
  "type": "moveTo",
  "target": "cameraController",
  "to": [0, 10, -20],
  "duration": 2.0,
  "easing": "inOutQuad"
}
```

### `localMoveTo`

Tween local position.

```json
{
  "type": "localMoveTo",
  "target": "cameraTarget",
  "to": [0, 1.5, 0],
  "duration": 0.5,
  "easing": "outQuad"
}
```

### `localRotateTo`

Tween local euler rotation (degrees).

```json
{
  "type": "localRotateTo",
  "target": "train",
  "to": [0, 90, 0],
  "duration": 1.0,
  "easing": "outQuad"
}
```

### `scaleTo`

Tween local scale.

```json
{
  "type": "scaleTo",
  "target": "ctaButton",
  "to": [1.2, 1.2, 1.2],
  "duration": 0.2,
  "easing": "outBack"
}
```

### Instant setters

| Action | Sets |
|---|---|
| `setPosition` | World position |
| `setLocalPosition` | Local position |
| `setLocalRotation` | Local euler rotation |
| `setLocalScale` | Local scale |

```json
{ "type": "setLocalPosition", "target": "tapHint", "to": [0, 100, 0] }
{ "type": "setLocalRotation", "target": "train", "to": [0, 45, 0] }
{ "type": "setLocalScale", "target": "ctaButton", "to": [1, 1, 1] }
```

`duration: 0` or omitted on tween actions snaps instantly.

### `fire`

Emit an event on a node or on the global scenario bus.

```json
{ "type": "fire", "event": "hint:showTap" }
{ "type": "fire", "target": "train", "event": "departed", "data": { "speed": 30 } }
```

Listen globally:

```typescript
ScenarioManager.events.on('hint:showTap', () => { /* ... */ });
```

### `call`

Call a public method on a component attached to a target node.

```json
{
  "type": "call",
  "target": "train",
  "component": "TrainController",
  "method": "startMovingToNextStop",
  "args": []
}
```

Pass resolved node references in args:

```json
{
  "type": "call",
  "target": "cameraController",
  "component": "ScenarioCameraController",
  "method": "followLocalOffset",
  "args": [{ "$node": "train" }, [0, 8, -18], true, true]
}
```

`script` is accepted as an alias for `component` (PlayCanvas JSON compatibility).

### `playSound` / `stopSound`

Play or stop an `AudioSource` on a target node.

```json
{ "type": "playSound", "target": "train", "index": 0 }
{ "type": "stopSound", "target": "train", "index": 0 }
```

`index` defaults to `0` (first AudioSource on the node).

---

## Easing

Supported on tween actions (`moveTo`, `localMoveTo`, `localRotateTo`, `scaleTo`):

| Value | Description |
|---|---|
| `linear` | Constant speed (default) |
| `inQuad` | Ease in |
| `outQuad` | Ease out |
| `inOutQuad` | Ease in and out |
| `outBack` | Overshoot at end |

---

## Global events

Static event bus on `ScenarioManager.events`:

| Event constant | String value | Effect |
|---|---|---|
| `ScenarioManager.Event.START` | `scenario:start` | Calls `startScenario()` |
| `ScenarioManager.Event.NEXT` | `scenario:next` | Calls `nextScenario()` |
| `ScenarioManager.Event.GOTO` | `scenario:goto` | Calls `gotoStep(idOrIndex)` |
| `ScenarioManager.Event.RESTART` | `scenario:restart` | Restarts from step 0 |
| `ScenarioManager.Event.STOP` | `scenario:stop` | Stops and cancels active jobs |
| `ScenarioManager.Event.FINISHED` | `scenario:finished` | Emitted when all steps complete |

### Emit from code

```typescript
import { ScenarioManager } from './ScenarioManager_Cocos388';

ScenarioManager.events.emit(ScenarioManager.Event.NEXT);
ScenarioManager.events.emit(ScenarioManager.Event.GOTO, 'showCTA');
ScenarioManager.events.emit(ScenarioManager.Event.STOP);
```

### Listen for completion

```typescript
ScenarioManager.events.on(ScenarioManager.Event.FINISHED, (manager) => {
    console.log('Scenario done');
});
```

---

## Public API

| Method | Description |
|---|---|
| `startScenario()` | Start from step 0 |
| `restartScenario()` | Same as `startScenario()` |
| `stopScenario()` | Cancel waits/tweens and stop |
| `nextScenario()` | Advance to next step, or unblock a `wait` step |
| `gotoStep(idOrIndex)` | Jump to step by `id` string or zero-based index |
| `setSteps(steps, restartNow?)` | Replace scenario at runtime |
| `rebuildReferenceMap()` | Rebuild entity key map after changing refs |
| `registerAction(type, handler)` | Add or override an action type |
| `unregisterAction(type)` | Remove a custom action handler |
| `buildScenario()` | Override in subclass or edit for code-defined scenarios |

### Read-only state

| Property | Description |
|---|---|
| `currentStepIndex` | Zero-based index of current or last step |
| `isRunning` | Whether a step is actively executing |
| `isWaitingForNext` | Whether paused on a `next: "wait"` step |

---

## Wiring a button to advance

Connect a Cocos Button click event directly to the ScenarioManager node:

- **Target:** ScenarioManager node
- **Component:** `ScenarioManager`
- **Handler:** `nextScenario`

Or from another script:

```typescript
ScenarioManager.events.emit(ScenarioManager.Event.NEXT);
```

## Hold + relay pattern

For hold-driven sequences (hold area + progress + xray liquid), a common setup is:

1. `HoldableArea3D` emits hold lifecycle events and can relay them through `EventTriggerRelay`.
2. `HoldProgressBarController` invokes `completedEvents` at 100%.
3. `EventTriggerRelay` emits `scenario:next` to `ScenarioManager.events`.
4. Scenario step uses `waitNext` or `waitEvent` and resumes automatically.

### Recommended inspector wiring

- Add `EventTriggerRelay` to a node (often the hold area or progress node).
- On `HoldableArea3D`, assign `eventRelay` and enable the hold lifecycle relay toggles you need.
- On `HoldProgressBarController.completedEvents`, call `EventTriggerRelay.triggerScenarioNext` (or `triggerApp` with `scenario:next`).

### Sequence-friendly JSON snippet

```json
{
  "id": "fillStage1",
  "mode": "sequence",
  "next": "auto",
  "actions": [
    { "type": "enable", "target": "xrayFill1", "value": true },
    { "type": "enable", "target": "xrayFill2", "value": false },
    {
      "type": "call",
      "target": "progressBar",
      "component": "HoldProgressBarController",
      "method": "resetProgress",
      "args": [0]
    },
    {
      "type": "call",
      "target": "xrayFill1",
      "component": "XrayLiquidFill",
      "method": "setFill",
      "args": [0]
    },
    {
      "type": "call",
      "target": "holdArea",
      "component": "HoldableArea3D",
      "method": "enableHold",
      "args": []
    },
    { "type": "waitNext" },
    {
      "type": "call",
      "target": "holdArea",
      "component": "HoldableArea3D",
      "method": "disableHold",
      "args": []
    },
    {
      "type": "call",
      "target": "trainQueue",
      "component": "PathQueueController",
      "method": "moveFrontToWaypointOneBased",
      "args": [2, 0, false, true]
    }
  ]
}
```

---

## Full example scenario (JSON)

Paste into **Steps Json** in the inspector:

```json
[
  {
    "id": "setup",
    "mode": "parallel",
    "next": "auto",
    "actions": [
      { "type": "enable", "target": "tapHint", "value": false },
      { "type": "enable", "target": "ctaButton", "value": false },
      { "type": "enable", "target": "train", "value": true }
    ]
  },
  {
    "id": "introCamera",
    "mode": "sequence",
    "next": "auto",
    "actions": [
      {
        "type": "call",
        "target": "cameraController",
        "component": "ScenarioCameraController",
        "method": "snapTo",
        "args": ["openingShot", true]
      },
      {
        "type": "call",
        "target": "cameraController",
        "component": "ScenarioCameraController",
        "method": "goTo",
        "args": ["trainShot", true, true, 2.0, "inOutQuad"]
      },
      { "type": "wait", "duration": 0.5 },
      { "type": "enable", "target": "tapHint", "value": true },
      {
        "type": "scaleTo",
        "target": "tapHint",
        "to": [1.15, 1.15, 1.15],
        "duration": 0.18,
        "easing": "outBack"
      },
      {
        "type": "scaleTo",
        "target": "tapHint",
        "to": [1, 1, 1],
        "duration": 0.12,
        "easing": "outQuad"
      }
    ]
  },
  {
    "id": "waitForUserTap",
    "mode": "sequence",
    "next": "wait",
    "actions": [
      { "type": "fire", "event": "hint:showTap" }
    ]
  },
  {
    "id": "afterUserTap",
    "mode": "parallel",
    "next": "auto",
    "actions": [
      { "type": "enable", "target": "tapHint", "value": false },
      {
        "type": "call",
        "target": "cameraController",
        "component": "ScenarioCameraController",
        "method": "followLocalOffset",
        "args": [{ "$node": "train" }, [0, 8, -18], true, true]
      },
      {
        "type": "call",
        "target": "train",
        "component": "TrainController",
        "method": "startMovingToNextStop",
        "args": []
      }
    ]
  },
  {
    "id": "showCTA",
    "mode": "sequence",
    "next": "wait",
    "actions": [
      { "type": "wait", "duration": 0.3 },
      {
        "type": "call",
        "target": "cameraController",
        "component": "ScenarioCameraController",
        "method": "stopFollowing",
        "args": []
      },
      { "type": "enable", "target": "ctaButton", "value": true },
      {
        "type": "scaleTo",
        "target": "ctaButton",
        "to": [1.2, 1.2, 1.2],
        "duration": 0.2,
        "easing": "outBack"
      },
      {
        "type": "scaleTo",
        "target": "ctaButton",
        "to": [1, 1, 1],
        "duration": 0.15,
        "easing": "outQuad"
      }
    ]
  }
]
```

Flow:

1. **setup** — hide UI, show train (parallel, auto-advance)
2. **introCamera** — camera intro + tap hint animation (sequence, auto-advance)
3. **waitForUserTap** — waits until player taps (calls `nextScenario()`)
4. **afterUserTap** — hide hint, follow train, start movement (parallel, auto-advance)
5. **showCTA** — stop follow, show CTA button (sequence, wait for next)

---

## Custom actions

Register new action types at runtime or in `onLoad`:

```typescript
scenarioManager.registerAction('log', (action) => {
    console.log('[Scenario]', action.data);
});

scenarioManager.registerAction('asyncLoad', async (action, token) => {
    await loadSomething();
    if (token !== scenarioManager['_token']) return; // cancelled check pattern
});
```

Use in JSON:

```json
{ "type": "log", "data": "Train departed" }
```

Handlers can return `void`, a `Promise`, or any value. Async handlers block the current sequence until resolved.

---

## Code-defined scenarios

Override or edit `buildScenario()` when you prefer TypeScript over JSON:

```typescript
public buildScenario(): ScenarioStep[] {
    return [
        {
            id: 'intro',
            mode: 'sequence',
            next: 'auto',
            actions: [
                { type: 'wait', duration: 1 },
                {
                    type: 'call',
                    target: 'cameraController',
                    component: 'ScenarioCameraController',
                    method: 'goTo',
                    args: ['trainShot', true, true, 2],
                },
            ],
        },
    ];
}
```

Replace at runtime:

```typescript
manager.setSteps(newSteps, true); // true = restart immediately
```

---

## Tips

- Use **entity keys** for gameplay objects (`train`, `cameraController`) and keep JSON readable.
- Use **`next: "wait"`** for player-driven beats; connect UI to `nextScenario()`.
- Use **`parallel`** when camera, train, and UI should animate at the same time.
- Enable **debugLogs** while authoring to see which steps and calls run.
- **`stopScenario()`** cancels all active waits and tweens via an internal token — safe to call on scene transitions.
- For camera-specific behavior, prefer `call` actions on `ScenarioCameraController` rather than raw `moveTo` on the camera node. See [ScenarioCameraController.md](./ScenarioCameraController.md).
- **`gotoStep('showCTA')`** is useful for branching or skipping ahead from code.
- If an action references a missing target or component, a warning is logged and execution continues (unless the handler throws and `stopOnActionError` is true).

---

## Related

- [ScenarioCameraController.md](./ScenarioCameraController.md) — camera poses, follow, look-at via `call` actions
