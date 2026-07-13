# RelativeScalePulser (Cocos 3.8.8)

Pulse a node's scale relatively (multiply from captured base scale), either on start or by method call.

**Script:** `assets/Scripts/Animation/RelativeScalePulser.ts`  
**Component name in editor:** `RelativeScalePulser`

## Typical setup

1. Add `RelativeScalePulser` to the node you want to pulse.
2. Optionally assign `targetNode` if pulsing another node.
3. Configure:
   - `pulseScale` (multiplier, for example `1.15,1.15,1.15`)
   - `pulseCount`
   - `pulseInfinitely` (optional, ignores `pulseCount`)
   - `durationPerPulse`
   - `easing`
4. Enable `autoPulseOnStart` if it should run automatically.

## Relative behavior

- Base scale is captured on load when `captureBaseOnLoad` is true.
- If `captureBaseEachPulse` is true, each pulse run recaptures current scale first.
- Pulse animation is: `base -> base * multiplier -> base`.
- If `pulseInfinitely` is true, pulsing continues until `stopPulse()` is called.

## Compatibility with ResponsiveUIScaler

- If the pulser target has `ResponsiveUIScaler`, pulser now animates the scaler's runtime multiplier instead of writing `node.scale` directly.
- This keeps responsive scale and pulse effect composed together, so both components can run on the same node without fighting each other.
- If no `ResponsiveUIScaler` is found, pulser keeps the original direct-scale behavior.

## Public API

- `pulse(waitForCompletion = false): void | Promise<void>`
- `pulseWithConfig(pulseCount?, durationPerPulse?, waitForCompletion?, scaleMultiplier?, easing?, pulseInfinitely?): void | Promise<void>`
- `stopPulse(restoreScale = true): void`
- `captureBaseScale(): void`

## ScenarioManager usage

Fire-and-forget pulse:

```json
{
  "type": "call",
  "target": "tapHint",
  "component": "RelativeScalePulser",
  "method": "pulse",
  "args": [false]
}
```

Blocking pulse (step waits for completion):

```json
{
  "type": "call",
  "target": "tapHint",
  "component": "RelativeScalePulser",
  "method": "pulseWithConfig",
  "args": [2, 0.25, true, [1.2, 1.2, 1.2], "sineInOut", false]
}
```

Infinite pulse (stop later by calling `stopPulse`):

```json
{
  "type": "call",
  "target": "tapHint",
  "component": "RelativeScalePulser",
  "method": "pulseWithConfig",
  "args": [1, 0.25, false, [1.15, 1.15, 1], "sineInOut", true]
}
```
