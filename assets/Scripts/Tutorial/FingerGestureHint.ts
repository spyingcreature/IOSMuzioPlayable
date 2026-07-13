import {
    _decorator,
    CCString,
    Component,
    Enum,
    Node,
    tween,
    Tween,
    Vec3,
} from 'cc';
import {
    PlayableEvent,
    PlayableEvents,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

enum GestureMode {
    Tap = 0,
    Swipe = 1,
    PressAndHold = 2,
}

Enum(GestureMode);

@ccclass('FingerGestureHint')
export class FingerGestureHint extends Component {
    @property({
        type: Node,
        tooltip: 'Node to animate. Defaults to this component node (parent of finger sprite).',
    })
    public targetNode: Node | null = null;

    @property({
        type: Enum(GestureMode),
        tooltip: 'Which gesture animation loop to play.',
    })
    public gestureMode: GestureMode = GestureMode.Tap;

    @property({
        type: Vec3,
        tooltip: 'Scale multiplier applied while pressed (e.g. 0.85 for smaller).',
    })
    public pressScale = new Vec3(0.85, 0.85, 1);

    @property({
        type: Vec3,
        tooltip: 'Local position offset for swipe mode.',
    })
    public swipeOffset = new Vec3(120, 0, 0);

    @property({
        min: 0,
        tooltip: 'Duration in seconds to scale down (press).',
    })
    public pressDuration = 0.12;

    @property({
        min: 0,
        tooltip: 'Duration in seconds to scale back to base (release).',
    })
    public releaseDuration = 0.12;

    @property({
        min: 0,
        tooltip: 'Duration in seconds to move to swipe offset (swipe mode only).',
    })
    public swipeMoveDuration = 0.45;

    @property({
        min: 0,
        tooltip: 'Pause in seconds while scaled down (press-and-hold mode only).',
    })
    public holdDuration = 0.6;

    @property({
        min: 0,
        tooltip: 'Pause in seconds between gesture loops.',
    })
    public loopDelay = 0.35;

    @property({
        type: CCString,
        tooltip: 'Tween easing name used for scale and move steps.',
    })
    public easing = 'sineInOut';

    @property({
        tooltip: 'Automatically start the hint loop when this component is enabled.',
    })
    public autoStartOnEnable = true;

    @property({
        tooltip: 'Capture target scale and position on load as the base transform.',
    })
    public captureBaseOnLoad = true;

    @property({
        tooltip: 'Restore base scale and position when the hint is stopped or disabled.',
    })
    public restoreOnStop = true;

    @property({
        tooltip: 'Hide the target node when disableHint() is called.',
    })
    public hideOnDisable = false;

    @property
    public debugLogs = false;

    private readonly _baseScale = new Vec3(1, 1, 1);
    private readonly _basePosition = new Vec3();
    private readonly _pressedScale = new Vec3(1, 1, 1);
    private readonly _swipeEndPosition = new Vec3();
    private _baseCaptured = false;
    private _disabled = false;
    private _runToken = 0;
    private _activeTween: Tween<Node> | null = null;

    protected onLoad(): void {
        if (this.captureBaseOnLoad) {
            this.captureBaseTransform();
        }
    }

    protected onEnable(): void {
        if (!this.autoStartOnEnable || this._disabled) {
            return;
        }

        this.startHint();
    }

    protected onDisable(): void {
        this.stopHint(this.restoreOnStop);
    }

    protected onDestroy(): void {
        this.stopHint(this.restoreOnStop);
    }

    public captureBaseTransform(): void {
        const target = this._getTargetNode();
        if (!target) {
            return;
        }

        Vec3.copy(this._baseScale, target.scale);
        Vec3.copy(this._basePosition, target.position);
        this._baseCaptured = true;
        this._log('Base transform captured:', this._baseScale, this._basePosition);
    }

    public startHint(): void {
        const target = this._getTargetNode();
        if (!target) {
            return;
        }

        this._disabled = false;

        if (!this._baseCaptured) {
            this.captureBaseTransform();
        }

        this.stopHint(false);
        this._snapToBase(target);
        this._startLoop(target);
    }

    /**
     * Stops the hint, restores the base transform, and optionally hides the target.
     * Wire this to a Button click event in the Inspector.
     */
    public disableHint(): void {
        if (this._disabled) {
            return;
        }

        this._disabled = true;
        this.stopHint(this.restoreOnStop);

        if (this.hideOnDisable) {
            const target = this._getTargetNode();
            if (target) {
                target.active = false;
            }
        }

        PlayableEvents.emit(PlayableEvent.HINT_DISMISSED);
        this._log('disabled');
    }

    public stopHint(restore = true): void {
        this._runToken++;

        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        if (restore) {
            const target = this._getTargetNode();
            if (target && this._baseCaptured) {
                this._snapToBase(target);
            }
        }
    }

    private _startLoop(target: Node): void {
        const token = this._runToken;
        const easing = this._sanitizeEasing(this.easing);

        Vec3.multiply(this._pressedScale, this._baseScale, this.pressScale);
        Vec3.add(this._swipeEndPosition, this._basePosition, this.swipeOffset);

        let singleCycle: Tween<Node>;

        switch (this.gestureMode) {
            case GestureMode.Swipe:
                singleCycle = this._buildSwipeLoop(target, easing, token);
                break;
            case GestureMode.PressAndHold:
                singleCycle = this._buildPressHoldLoop(target, easing);
                break;
            case GestureMode.Tap:
            default:
                singleCycle = this._buildTapLoop(target, easing);
                break;
        }

        this._activeTween = tween(target).repeatForever(singleCycle).start();
        this._log('started', GestureMode[this.gestureMode]);
    }

    private _buildTapLoop(target: Node, easing: string): Tween<Node> {
        const pressDuration = this._sanitizeDuration(this.pressDuration);
        const releaseDuration = this._sanitizeDuration(this.releaseDuration);
        const loopDelay = this._sanitizeDuration(this.loopDelay);

        return tween(target)
            .to(pressDuration, { scale: this._pressedScale }, { easing })
            .to(releaseDuration, { scale: this._baseScale }, { easing })
            .delay(loopDelay);
    }

    private _buildSwipeLoop(target: Node, easing: string, token: number): Tween<Node> {
        const pressDuration = this._sanitizeDuration(this.pressDuration);
        const swipeMoveDuration = this._sanitizeDuration(this.swipeMoveDuration);
        const loopDelay = this._sanitizeDuration(this.loopDelay);

        return tween(target)
            .to(pressDuration, { scale: this._pressedScale }, { easing })
            .to(swipeMoveDuration, { position: this._swipeEndPosition }, { easing })
            .delay(loopDelay)
            .call(() => {
                if (token !== this._runToken) {
                    return;
                }

                this._snapToBase(target);
            });
    }

    private _buildPressHoldLoop(target: Node, easing: string): Tween<Node> {
        const pressDuration = this._sanitizeDuration(this.pressDuration);
        const holdDuration = this._sanitizeDuration(this.holdDuration);
        const releaseDuration = this._sanitizeDuration(this.releaseDuration);
        const loopDelay = this._sanitizeDuration(this.loopDelay);

        return tween(target)
            .to(pressDuration, { scale: this._pressedScale }, { easing })
            .delay(holdDuration)
            .to(releaseDuration, { scale: this._baseScale }, { easing })
            .delay(loopDelay);
    }

    private _snapToBase(target: Node): void {
        target.setScale(this._baseScale);
        target.setPosition(this._basePosition);
    }

    private _getTargetNode(): Node | null {
        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            return null;
        }
        return target;
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }

        return Math.max(0, value);
    }

    private _sanitizeEasing(value: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : 'sineInOut';
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[FingerGestureHint]', ...args);
    }
}
