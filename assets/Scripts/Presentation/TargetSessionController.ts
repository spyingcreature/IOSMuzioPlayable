import {
    _decorator,
    Component,
    Label,
} from 'cc';
import { ScannableTarget } from '../Detection/ScannableTarget';
import { DraggableNode2D } from '../Input/DraggableNode2D';
import { RevealPanelController } from '../UI/RevealPanelController';
import { NodePopInOut } from '../Animation/NodePopInOut';
import {
    PlayableEvent,
    PlayableEvents,
    type TargetScanCompletedPayload,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

@ccclass('TargetSessionController')
export class TargetSessionController extends Component {
    @property({
        type: [ScannableTarget],
        tooltip: 'Explicit targets to track. Auto-collects from scene when empty.',
    })
    public targets: ScannableTarget[] = [];

    @property({
        type: DraggableNode2D,
        tooltip: 'Optional draggable disabled when the session completes.',
    })
    public draggable: DraggableNode2D | null = null;

    @property({
        type: RevealPanelController,
        tooltip: 'Optional end panel shown when all targets are complete.',
    })
    public endPanel: RevealPanelController | null = null;

    @property({
        type: Label,
        tooltip: 'Optional progress label, e.g. 2/3.',
    })
    public progressLabel: Label | null = null;

    @property({
        min: 0,
        tooltip: 'Delay in seconds before showing the end panel.',
    })
    public endDelay = 0.4;

    @property({
        tooltip: 'Disable draggable input when session completes.',
    })
    public disableDragOnComplete = true;

    @property
    public debugLogs = false;

    private _resolvedTargets: ScannableTarget[] = [];
    private _completedCount = 0;
    private _sessionComplete = false;
    private _boundHandler: ((payload: TargetScanCompletedPayload) => void) | null = null;

    protected onLoad(): void {
        this._resolveTargetList();
        this._updateProgressLabel();
    }

    protected onEnable(): void {
        this._boundHandler = (payload: TargetScanCompletedPayload) => {
            this._onTargetCompleted(payload);
        };
        PlayableEvents.on(PlayableEvent.TARGET_SCAN_COMPLETED, this._boundHandler, this);
    }

    protected onDisable(): void {
        if (this._boundHandler) {
            PlayableEvents.off(PlayableEvent.TARGET_SCAN_COMPLETED, this._boundHandler, this);
            this._boundHandler = null;
        }
    }

    public refreshTargets(): void {
        this._resolveTargetList();
        this._recountCompleted();
        this._updateProgressLabel();
    }

    public get completedCount(): number {
        return this._completedCount;
    }

    public get totalCount(): number {
        return this._resolvedTargets.length;
    }

    public get isSessionComplete(): boolean {
        return this._sessionComplete;
    }

    private _onTargetCompleted(payload: TargetScanCompletedPayload): void {
        if (this._sessionComplete) {
            return;
        }

        const target = payload?.target;
        if (!target || !this._resolvedTargets.includes(target)) {
            return;
        }

        this._recountCompleted();
        this._updateProgressLabel();
        this._log('completed', this._completedCount, '/', this._resolvedTargets.length);

        if (this._completedCount < this._resolvedTargets.length) {
            return;
        }

        void this._completeSession();
    }

    private async _completeSession(): Promise<void> {
        if (this._sessionComplete) {
            return;
        }

        this._sessionComplete = true;

        if (this.disableDragOnComplete && this.draggable) {
            this.draggable.setDragEnabled(false);
        }

        PlayableEvents.emit(PlayableEvent.SESSION_COMPLETE);

        if (this.endDelay > 0) {
            await this._wait(this.endDelay);
        }
        if(this.progressLabel) {
            const progressPopOut = this.progressLabel.getComponent(NodePopInOut)
                ?? this.progressLabel.getComponentInChildren(NodePopInOut);

            if (progressPopOut) {
                await progressPopOut.popOut(true);
            }
        }

        if (this.endPanel) {
            await this.endPanel.show();
        }

        this._log('session complete');
    }

    private _resolveTargetList(): void {
        if (this.targets.length > 0) {
            this._resolvedTargets = this.targets.filter(
                (target) => target && target.isValid,
            );
            return;
        }

        const scene = this.node.scene;
        this._resolvedTargets = scene
            ? scene.getComponentsInChildren(ScannableTarget)
            : [];
    }

    private _recountCompleted(): void {
        let count = 0;
        for (let i = 0; i < this._resolvedTargets.length; i += 1) {
            if (this._resolvedTargets[i].isComplete) {
                count += 1;
            }
        }
        this._completedCount = count;
    }

    private _updateProgressLabel(): void {
        if (!this.progressLabel) {
            return;
        }

        this.progressLabel.string = `${this._completedCount}/${this._resolvedTargets.length}`;
    }

    private _wait(seconds: number): Promise<void> {
        return new Promise((resolve) => {
            this.scheduleOnce(() => resolve(), seconds);
        });
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[TargetSessionController]', ...args);
    }
}
