import {
    _decorator,
    CCString,
    Color,
    Component,
    Enum,
    Rect,
    Sprite,
    UITransform,
    Vec3,
} from 'cc';
import {
    PlayableEvent,
    PlayableEvents,
    type TargetScanCompletedPayload,
    type TargetScanStartedPayload,
    type TargetScanWrongPayload,
} from '../Core/PlayableEvents';
import { OpacityBlinker } from '../Animation/OpacityBlinker';
import { TargetScanProgressBar } from '../UI/TargetScanProgressBar';
import { OverlapMode } from './ViewportBounds';

const { ccclass, property } = _decorator;

export const ScannableTargetEvent = {
    PROGRESS_STARTED: 'target-progress-started',
    PROGRESS_COMPLETED: 'target-progress-completed',
    PROGRESS_CANCELLED: 'target-progress-cancelled',
} as const;

Enum(OverlapMode);

@ccclass('ScannableTarget')
export class ScannableTarget extends Component {
    @property({
        type: CCString,
        tooltip: 'Unique identifier for this target.',
    })
    public id = '';

    @property({
        type: CCString,
        tooltip: 'Text shown on the label when this target is detected.',
    })
    public labelText = '';

    @property({
        type: Vec3,
        tooltip: 'Local offset from the target node used when placing a label.',
    })
    public labelOffset = new Vec3(0, 120, 0);

    @property({
        type: Enum(OverlapMode),
        tooltip: 'How this target is considered inside a viewport.',
    })
    public detectionMode: OverlapMode = OverlapMode.CenterInside;

    @property({
        range: [0, 1, 0.01],
        tooltip: 'Minimum overlap ratio when detection mode is OverlapPercent.',
    })
    public overlapThreshold = 0.35;

    @property({
        type: TargetScanProgressBar,
        tooltip: 'Per-target hold progress UI. Position the node manually in the editor.',
    })
    public scanProgress: TargetScanProgressBar | null = null;

    @property({
        min: 0,
        tooltip: 'Seconds to fill while held in view. 0 uses ViewportOverlapDetector default.',
    })
    public scanDuration = 0;

    @property({
        type: [OpacityBlinker],
        tooltip: 'Highlight blinkers to stop when this target is scanned successfully.',
    })
    public blinkersToStopOnComplete: OpacityBlinker[] = [];

    @property({
        type: [Sprite],
        tooltip: 'Sprites dimmed when this target is scanned as a wrong answer.',
    })
    public spriteNodes: Sprite[] = [];

    @property({
        tooltip: 'Optional per-target dim color used by markWrong().',
    })
    public wrongDimColor = new Color(120, 120, 120, 255);

    @property
    public debugLogs = false;

    private _isComplete = false;
    private _isInProgress = false;
    private _isExcluded = false;
    private readonly _originalSpriteColors = new Map<Sprite, Color>();

    public get isComplete(): boolean {
        return this._isComplete;
    }

    public get isInProgress(): boolean {
        return this._isInProgress;
    }

    public get isExcluded(): boolean {
        return this._isExcluded;
    }

    public getWorldRect(out?: Rect): Rect {
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) {
            if (out) {
                out.set(0, 0, 0, 0);
                return out;
            }
            return new Rect(0, 0, 0, 0);
        }

        const box = uiTransform.getBoundingBoxToWorld();
        if (out) {
            out.set(box);
            return out;
        }
        return new Rect(box);
    }

    public getLabelWorldPosition(out?: Vec3): Vec3 {
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) {
            if (out) {
                out.set(this.node.worldPosition);
                return out;
            }
            return this.node.worldPosition.clone();
        }

        const worldPoint = uiTransform.convertToWorldSpaceAR(this.labelOffset);
        if (out) {
            out.set(worldPoint);
            return out;
        }
        return worldPoint.clone();
    }

    public beginProgress(): boolean {
        if (this._isComplete || this._isInProgress || this._isExcluded) {
            return false;
        }

        this._isInProgress = true;
        this.node.emit(ScannableTargetEvent.PROGRESS_STARTED);
        this._log('beginProgress', this.id);
        return true;
    }

    public cancelProgress(): void {
        if (!this._isInProgress || this._isComplete) {
            return;
        }

        this._isInProgress = false;
        this.node.emit(ScannableTargetEvent.PROGRESS_CANCELLED);
        this.scanProgress?.reset();
        this._log('cancelProgress', this.id);
    }

    public updateScanProgress(ratio: number): void {
        if (!this.scanProgress) {
            return;
        }

        if (!this.scanProgress.isVisible()) {
            this.scanProgress.show();
        }

        this.scanProgress.setProgress(ratio);
    }

    public hideScanProgress(): void {
        this.scanProgress?.hide();
    }

    public markComplete(): void {
        if (this._isComplete) {
            return;
        }

        this._isInProgress = false;
        this._isComplete = true;

        this.node.emit(ScannableTargetEvent.PROGRESS_COMPLETED);

        const payload: TargetScanCompletedPayload = { target: this };
        PlayableEvents.emit(PlayableEvent.TARGET_SCAN_COMPLETED, payload);
        this._stopLinkedBlinkers();
        this._log('markComplete', this.id);
    }

    public notifyScanStarted(): void {
        const payload: TargetScanStartedPayload = { target: this };
        PlayableEvents.emit(PlayableEvent.TARGET_SCAN_STARTED, payload);
        this._log('notifyScanStarted', this.id);
    }

    public markWrong(color?: Color): void {
        if (this._isExcluded || this._isComplete) {
            return;
        }

        this._isExcluded = true;
        this._isInProgress = false;
        this.hideScanProgress();
        this.scanProgress?.reset();
        this._applyDimColor(color ?? this.wrongDimColor);

        const payload: TargetScanWrongPayload = { target: this };
        PlayableEvents.emit(PlayableEvent.TARGET_SCAN_WRONG, payload);
        this._log('markWrong', this.id);
    }

    public reset(): void {
        this._isComplete = false;
        this._isInProgress = false;
        this._isExcluded = false;
        this._restoreSpriteColors();
        this.hideScanProgress();
        this.scanProgress?.reset();
    }

    private _applyDimColor(color: Color): void {
        for (let i = 0; i < this.spriteNodes.length; i += 1) {
            const sprite = this.spriteNodes[i];
            if (!sprite?.isValid) {
                continue;
            }

            if (!this._originalSpriteColors.has(sprite)) {
                this._originalSpriteColors.set(sprite, sprite.color.clone());
            }

            sprite.color = color.clone();
        }
    }

    private _restoreSpriteColors(): void {
        this._originalSpriteColors.forEach((originalColor, sprite) => {
            if (sprite?.isValid) {
                sprite.color = originalColor.clone();
            }
        });
        this._originalSpriteColors.clear();
    }

    private _stopLinkedBlinkers(): void {
        for (let i = 0; i < this.blinkersToStopOnComplete.length; i += 1) {
            const blinker = this.blinkersToStopOnComplete[i];
            if (blinker?.isValid) {
                blinker.stopBlink();
            }
        }
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[ScannableTarget]', ...args);
    }
}
