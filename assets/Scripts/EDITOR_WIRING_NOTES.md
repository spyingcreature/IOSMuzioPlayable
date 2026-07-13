# Editor Wiring Notes — AI Scanner Playable

Scripts-only kit. After importing art and building nodes in the Cocos Editor, wire components as follows.

## Canvas

- Add `ResponsiveUIScaler` to the root UI node.
- Set **Reference Resolution** to `1080 x 1920` (portrait).

## Phone / viewport rig

Suggested node tree:

```
PhoneCamera
├── PhoneFrame        (Sprite — PNG with transparent center)
├── Lens              (empty node, UITransform matches transparent hole)
│   └── Laser         (Sprite — thin horizontal bar)
```

Components on **PhoneCamera**:

| Component | Notes |
|-----------|--------|
| `DraggableNode2D` | Main drag behavior |
| `DragBoundsClamp` | Optional; assign as `boundsClamp` on draggable |
| `ViewportOverlapDetector` | Detection loop |
| `VerticalSweepEffect` | Laser sweep |

Inspector wiring:

- `ViewportOverlapDetector.viewport` → `Lens` (`ViewportBounds`)
- `ViewportOverlapDetector.sweepEffect` → `VerticalSweepEffect` on same node
- `ViewportOverlapDetector.draggable` → `DraggableNode2D` on same node
- `VerticalSweepEffect.boundsNode` → `Lens`
- `VerticalSweepEffect.sweepNode` → `Laser`

Add `ViewportBounds` to **Lens**.

## Scannable objects

For each object sprite:

- Add `ScannableTarget`
- Set `id`, `labelText`, `labelOffset` (e.g. `(0, 120, 0)` above object)
- Default detection: **CenterInside**
- Optional: assign **Blinkers To Stop On Complete** → matching highlight node's `OpacityBlinker` (e.g. `camera-highlight` under `Highlights`)

## Per-target scan progress

Each scannable object can show a hold-to-scan progress UI while the lens stays over it. Position the progress node yourself in the Hierarchy; the scripts only show/hide and drive fill.

Suggested node tree (child or sibling of the object — your choice):

```
FlowerSprite          ← ScannableTarget here
└── ScanProgress      ← inactive at start; place above the object visually
    ├── Track         ← optional background Sprite (static ring/bar)
    └── Fill          ← Sprite used for fill
```

Steps per object:

1. Create `ScanProgress` under (or next to) the object; move it where you want it.
2. Set **ScanProgress** inactive in the Hierarchy (script activates on detect).
3. Add **`TargetScanProgressBar`** to `ScanProgress` (or a child).
4. On **`ScannableTarget`** → assign **Scan Progress** → the `TargetScanProgressBar` component.
5. Optionally set **Scan Duration** on that target (overrides detector default).
6. On **`ViewportOverlapDetector`** → set **Default Scan Duration** (e.g. `1.2` seconds).

### Circular progress (Cocos 3.8.8)

On the **Fill** child Sprite:

| Property | Value |
|----------|-------|
| Type | **FILLED** |
| Fill Type | **RADIAL** |
| Fill Center | `(0.5, 0.5)` |
| Fill Start | `0.25` (top; tweak to taste) |
| Fill Range | `0` at rest |

Wire `TargetScanProgressBar.fillSprite` → **Fill** Sprite. Use a ring PNG on **Track** (normal Sprite) and **Fill** (filled radial arc).

### Linear progress alternative

**A) Sprite fill:** Fill Type **HORIZONTAL** or **VERTICAL** on **Fill** → assign to `fillSprite`.

**B) ProgressBar component:** Add Cocos `ProgressBar` on `ScanProgress` → assign to `TargetScanProgressBar.progressBar` (leave `fillSprite` empty).

Optional: add `NodePopInOut` on `ScanProgress` for pop animation (not wired by script in v1).

## Labels

Create a manager node (e.g. `GameManager`) with:

| Component | Wiring |
|-----------|--------|
| `TargetLabelPresenter` | `labelParent` → empty `LabelsLayer` node; `labelPrefab` → your label prefab (create in editor later) |
| `TargetSessionController` | `draggable` → phone; `endPanel` → end card panel |

Label prefab should include:

- A `Label` (or child named `Label` if using `labelNodeName`)
- Optional `NodePopInOut` for pop-in animation
- Optional `ContentSizeFollower` on the bubble root with `sourceNode` pointing at the label child

## End card

Suggested node tree:

```
EndCard (inactive at start)
├── Title             (Label)
├── CTAButton         (Button + Sprite)
```

Components:

| Node | Component | Notes |
|------|-----------|--------|
| EndCard | `RevealPanelController` | `titleText` = `"Identify anything!"`; add title + CTA to `contentNodes` |
| CTAButton | `PlayableCTA` | Set `url` to store link |

Wire `TargetSessionController.endPanel` → `RevealPanelController` on EndCard.

## Optional tutorial

- Add `DragHandTutorial` to a hand sprite node.
- Assign `draggable` → phone `DraggableNode2D`.
- Assign `hintTarget` → phone node (or leave hand only).

## Finger gesture hint

Suggested node tree:

```
FingerHintRoot          ← FingerGestureHint here
└── FingerSprite        (Sprite — hand/finger image)
```

Steps:

1. Create `FingerHintRoot` with a finger sprite child.
2. Add **`FingerGestureHint`** to `FingerHintRoot` (or assign **Target Node** to another animated node).
3. Set **Gesture Mode**:
   - **Tap** — scale down, release, pause, repeat
   - **Swipe** — scale down, move by **Swipe Offset**, pause, reset, repeat
   - **Press And Hold** — scale down, hold, release, pause, repeat
4. Tune **Press Scale**, durations, and **Loop Delay** in the Inspector.
5. To dismiss after the user acts, wire a Button **click** event:
   - Target → `FingerHintRoot`
   - Component → `FingerGestureHint`
   - Handler → `disableHint`
6. Optional: enable **Hide On Disable** to hide the hint node when `disableHint()` runs.

## Optional progress HUD

- Add a `Label` to HUD.
- Assign to `TargetSessionController.progressLabel`.
- Add `ContentSizeFollower` on the progress bubble node; set `sourceNode` to the label node that updates (same node is supported). Tune `padding` in pixels or percent so the background still fits when text changes (e.g. `1/3` → `3/3`).

## Recommended timing (Inspector defaults)

| Component | Property | Value |
|-----------|----------|-------|
| `ViewportOverlapDetector` | `defaultScanDuration` | `1.2` |
| `VerticalSweepEffect` | `duration` | `0.3` |
| `NodePopInOut` | `popInDuration` | `0.25` |
| `TargetSessionController` | `endDelay` | `0.4` |
| `RevealPanelController` | `contentStagger` | `0.2` |

## Event flow (for debugging)

1. User drags phone → `ViewportOverlapDetector` finds overlap
2. Hold progress fills while target stays in view; leaving view cancels and hides progress
3. At 100% → `VerticalSweepEffect.play()` runs
4. `PlayableEvent.TARGET_SCAN_STARTED` → `TargetLabelPresenter` spawns label
5. `ScannableTarget.markComplete()` → `PlayableEvent.TARGET_SCAN_COMPLETED`
6. All targets done → `PlayableEvent.SESSION_COMPLETE` → `RevealPanelController.show()`
7. CTA click → `PlayableEvent.CTA_CLICKED` → store URL opens

## Reuse in other projects

Copy the entire `assets/Scripts/` folder. Components are scenario-agnostic; swap art, targets, and panel copy in the Inspector.

---

## Find-and-Scan quest mode (Main2)

Single-objective quiz: one random target is announced at start, wrong scans grey out objects and reveal labels, correct scan plays title pop-out → success toast → end panel. Driven by `ScenarioManager` + `assets/Data/Scenarios/main2-find-scan.json`.

### Prerequisites

- Phone rig wired as above (`DraggableNode2D`, `ViewportOverlapDetector`, `ViewportBounds`, `VerticalSweepEffect`)
- Six scannable objects with `ScannableTarget` + per-target `TargetScanProgressBar`
- `HandTutor` with `FingerGestureHint` (swipe mode recommended)
- `handphone2` → `DraggableNode2D.firstTouchEvents` → `FingerGestureHint.disableHint`
- End panel node with `RevealPanelController` + `NodePopInOut` on content children

### Do NOT add in quest mode

| Component | Reason |
|-----------|--------|
| `TargetLabelPresenter` | Conflicts with `ScanQuestController` scan routing |
| `TargetSessionController` | Completes when all targets scan; quest ends on one correct scan |

### New nodes to create

**Success toast** (under Canvas):

```
SuccessToast          ← inactive at start; NodePopInOut here
└── Label             ← success message text
```

**Announcer** (`objectiveHolder`):

```
objectiveHolder       ← NodePopInOut + ObjectiveAnnouncer
├── PrefixLabel       ← static "Find and Scan"
└── ObjectiveName     ← dynamic name (Label or RichText)
```

### ScenarioManager node

Add components:

| Component | Purpose |
|-----------|---------|
| `ScanQuestController` | Random objective, wrong/correct scan handling |
| `PlayableScenarioBridge` | Relays `PlayableEvents` → `ScenarioManager.events` for `waitEvent` |

**Entity keys / refs** (matching indexes):

| Entity key | Node |
|------------|------|
| `fingerHint` | `HandTutor` |
| `phone` | `handphone2` |
| `quest` | `ScenarioManager` node (same node as `ScanQuestController`) |
| `announcer` | `objectiveHolder` |
| `endPanel` | End panel root (`RevealPanelController`) |
| `successToast` | `SuccessToast` node |

**ScenarioManager inspector:**

- **Steps Asset** → `assets/Data/Scenarios/main2-find-scan.json`
- Leave **Steps Json** empty (unless overriding)
- **Auto Start** → enabled

### ScanQuestController wiring

| Property | Assign to |
|----------|-----------|
| `targets[]` | All 6 `ScannableTarget` components (or leave empty to auto-collect) |
| `viewportDetector` | `ViewportOverlapDetector` on `handphone2` |
| `objectiveAnnouncer` | `ObjectiveAnnouncer` on `objectiveHolder` |
| `successToast` | `SuccessToast` node |
| `wrongLabelPrefab` | Label prefab (same style as scan labels) |
| `wrongLabelParent` | `LabelsLayer` or empty node under Canvas |
| `successMessage` | e.g. `"Correct!"` |
| `successHoldDelay` | `0.8` |
| `dimColor` | Grey tint for wrong targets, e.g. `(120, 120, 120, 255)` |

### ViewportOverlapDetector (quest hook)

On `handphone2` → `ViewportOverlapDetector`:

- **Scan Completion Handler** → `ScanQuestController` on `ScenarioManager` node

This bypasses `notifyScanStarted()` / `TargetLabelPresenter` and routes completed scans to `ScanQuestController.onScanFinished()`.

### ObjectiveAnnouncer wiring

| Property | Assign to |
|----------|-----------|
| `rootNode` | `objectiveHolder` |
| `popInOut` | `NodePopInOut` on `objectiveHolder` |
| `prefixLabel` | `PrefixLabel` |
| `objectiveLabel` or `objectiveRichText` | `ObjectiveName` child |
| `nameTemplate` | `The "{name}"!` |
| `popInOnSetObjective` | `true` |

**NodePopInOut on objectiveHolder:** `startHidden: true`, `captureBaseOnLoad: true`, `popOutDuration: 0.2`

### ScannableTarget (per object)

Add to each of the 6 objects:

- **Sprite Nodes** → object's main `Sprite` (dimmed on wrong scan)

### End panel

- `RevealPanelController` on end panel root (`startHidden: true`)
- Add icon/label children to `contentNodes[]` (each with `NodePopInOut` for staggered reveal)
- `PlayableCTA` on CTA button with store URL

### Correct-scan animation order

1. Title / announcer `popOut()` on `objectiveHolder`
2. Success toast `popInThenOut()` on `SuccessToast`
3. `quest:complete` event → scenario shows end panel

### Event flow (quest mode)

1. Scene loads → `ScenarioManager` runs `setup` → finger hint starts + `startRandomQuest()` picks random target + announcer pops in with `"The [labelText]!"`
2. User touches phone → `FingerGestureHint.disableHint()` → `hint:dismissed` → scenario unblocks (quest already active)
3. User scans wrong object → hold + sweep → wrong label spawns at object + sprite dims + target excluded
4. User scans correct object → announcer `popOut()` → success toast `popInThenOut()` → `quest:complete` → drag disabled → `RevealPanelController.show()`
5. CTA click → store URL opens

### Troubleshooting

| Symptom | Check |
|---------|-------|
| Train demo runs instead of quest | `stepsAsset` assigned; `stepsJson` empty; `PlayableScenarioBridge` present |
| Quest never starts | `ScanQuestController` on entity `quest`; `startRandomQuest` called in JSON setup step |
| Wrong scan does nothing | `scanCompletionHandler` wired on detector; `wrongLabelPrefab` + parent assigned |
| Wrong scan doesn't grey out | `ScannableTarget.spriteNodes[]` has object Sprite assigned |
| End panel never shows | `PlayableScenarioBridge` relays `quest:complete`; `endPanel` entity key wired; `RevealPanelController` on node |
| Success toast missing | `successToast` entity key + `ScanQuestController.successToast` assigned; node has `NodePopInOut` |
| Title doesn't pop out before success | `ObjectiveAnnouncer.popInOut` wired; `NodePopInOut` on `objectiveHolder` |

