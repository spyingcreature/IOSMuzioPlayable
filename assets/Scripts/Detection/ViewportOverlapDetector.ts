import {
    _decorator,
    Component,
    Rect,
} from 'cc';
import { ViewportBounds } from './ViewportBounds';
import { ScannableTarget } from './ScannableTarget';
import { VerticalSweepEffect } from '../Effects/VerticalSweepEffect';
import { DraggableNode2D } from '../Input/DraggableNode2D';

const { ccclass, property } = _decorator;

@ccclass('ViewportOverlapDetector')
export class ViewportOverlapDetector extends Component {
    @property({
        type: ViewportBounds,
        tooltip: 'Viewport used for overlap tests.',
    })
    public viewport: ViewportBounds | null = null;

    @property({
        type: VerticalSweepEffect,
        tooltip: 'Effect played when a target enters the viewport.',
    })
    public sweepEffect: VerticalSweepEffect | null = null;

    @property({
        type: [ScannableTarget],
        tooltip: 'Explicit target list. If empty, auto-collects ScannableTarget components in the scene.',
    })
    public targets: ScannableTarget[] = [];

    @property({
        type: DraggableNode2D,
        tooltip: 'Optional draggable reference. Detection only runs while dragging when set.',
    })
    public draggable: DraggableNode2D | null = null;

    @property({
        tooltip: 'Only evaluate overlap while the draggable is being dragged.',
    })
    public requireDragging = true;

    @property({
        tooltip: 'Disable detection after all configured targets are complete.',
    })
    public stopWhenAllComplete = true;

    @property({
        min: 0,
        tooltip: 'Seconds to fill scan progress while a target stays in view.',
    })
    public defaultScanDuration = 1.2;

    @property({
        type: Component,
        tooltip: 'Optional handler with onScanFinished(target). Bypasses notifyScanStarted when set.',
    })
    public scanCompletionHandler: Component | null = null;

    @property
    public debugLogs = false;

    private readonly _viewportRect = new Rect();
    private readonly _targetRect = new Rect();
    private _activeTarget: ScannableTarget | null = null;
    private _fillProgress = 0;
    private _isProcessing = false;
    private _detectionEnabled = true;
    private _resolvedTargets: ScannableTarget[] = [];

    protected onLoad(): void {
        this._resolveTargetList();

        if (!this.viewport) {
            this.viewport = this.getComponent(ViewportBounds);
        }

        if (!this.sweepEffect) {
            this.sweepEffect = this.getComponent(VerticalSweepEffect);
        }

        if (!this.draggable) {
            this.draggable = this.getComponent(DraggableNode2D);
        }
    }

    protected update(dt: number): void {
        if (!this._detectionEnabled) {
            return;
        }

        if (this.requireDragging && this.draggable && !this.draggable.isDragging) {
            this._cancelActiveScan();
            return;
        }

        if (!this.viewport) {
            return;
        }

        if (this.stopWhenAllComplete && this._areAllTargetsComplete()) {
            this._detectionEnabled = false;
            return;
        }

        if (this._activeTarget && !this._isProcessing) {
            const target = this._activeTarget;
            if (!this._targetOverlaps(target)) {
                this._cancelActiveScan();
                return;
            }

            const duration = this._getScanDuration(target);
            if (duration <= 0) {
                this._fillProgress = 1;
            } else {
                this._fillProgress += dt / duration;
            }

            target.updateScanProgress(this._fillProgress);

            if (this._fillProgress >= 1) {
                void this._finishScan(target);
            }
            return;
        }

        if (this._isProcessing) {
            return;
        }

        for (let i = 0; i < this._resolvedTargets.length; i += 1) {
            const target = this._resolvedTargets[i];
            if (!target || target.isComplete || target.isInProgress || target.isExcluded) {
                continue;
            }

            if (!this._targetOverlaps(target)) {
                continue;
            }

            this._startScan(target);
            break;
        }
    }

    public setDetectionEnabled(enabled: boolean): void {
        this._detectionEnabled = enabled;
    }

    public refreshTargets(): void {
        this._resolveTargetList();
    }

    private _startScan(target: ScannableTarget): void {
        if (!target.beginProgress()) {
            return;
        }

        this._activeTarget = target;
        this._fillProgress = 0;
        target.updateScanProgress(0);
        this._log('scan started', target.id);
    }

    private _cancelActiveScan(): void {
        if (!this._activeTarget || this._isProcessing) {
            return;
        }

        this._log('scan cancelled', this._activeTarget.id);
        this._activeTarget.cancelProgress();
        this._activeTarget = null;
        this._fillProgress = 0;
    }

    private async _finishScan(target: ScannableTarget): Promise<void> {
        target.hideScanProgress();
        this._isProcessing = true;
        this._log('scan complete', target.id);

        if (this.sweepEffect) {
            await this.sweepEffect.play();
        }

        const handler = this.scanCompletionHandler;
        const onScanFinished = handler
            ? (handler as { onScanFinished?: (t: ScannableTarget) => unknown }).onScanFinished
            : undefined;

        if (typeof onScanFinished === 'function') {
            await onScanFinished.call(handler, target);
        } else {
            target.notifyScanStarted();
        }

        this._activeTarget = null;
        this._fillProgress = 0;
        this._isProcessing = false;
    }

    private _targetOverlaps(target: ScannableTarget): boolean {
        if (!this.viewport) {
            return false;
        }

        const targetRect = target.getWorldRect(this._targetRect);
        return this.viewport.overlapsRect(
            targetRect,
            target.detectionMode,
            target.overlapThreshold,
        );
    }

    private _getScanDuration(target: ScannableTarget): number {
        return target.scanDuration > 0 ? target.scanDuration : this.defaultScanDuration;
    }

    private _resolveTargetList(): void {
        if (this.targets.length > 0) {
            this._resolvedTargets = this.targets.filter(
                (target) => target && target.isValid,
            );
            return;
        }

        const scene = this.node.scene;
        if (!scene) {
            this._resolvedTargets = [];
            return;
        }

        this._resolvedTargets = scene.getComponentsInChildren(ScannableTarget);
    }

    private _areAllTargetsComplete(): boolean {
        if (this._resolvedTargets.length <= 0) {
            return false;
        }

        for (let i = 0; i < this._resolvedTargets.length; i += 1) {
            if (!this._resolvedTargets[i].isComplete) {
                return false;
            }
        }
        return true;
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[ViewportOverlapDetector]', ...args);
    }
}
