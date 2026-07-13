import {
    _decorator,
    CCInteger,
    CCString,
    Component,
    Label,
    Sprite,
    tween,
    Tween,
} from 'cc';
import { SpriteFillAnimator } from '../Animation/SpriteFillAnimator';

const { ccclass, property } = _decorator;

@ccclass('SpriteFillProgressDisplay')
export class SpriteFillProgressDisplay extends Component {
    @property({
        type: SpriteFillAnimator,
        tooltip: 'Optional animator used for applying fill values.',
    })
    public fillAnimator: SpriteFillAnimator | null = null;

    @property({
        type: Sprite,
        tooltip: 'Fallback sprite when fillAnimator is not assigned.',
    })
    public fillSprite: Sprite | null = null;

    @property({
        type: Label,
        tooltip: 'Optional label to render percentage text.',
    })
    public percentageLabel: Label | null = null;

    @property({
        min: -1,
        max: 1,
        tooltip: 'Default starting fill/progress (-1..1) used by play(). Negative values reverse fill direction.',
    })
    public fromProgress = 0;

    @property({
        min: -1,
        max: 1,
        tooltip: 'Default ending fill/progress (-1..1). Negative values reverse fill direction.',
    })
    public toProgress = 1;

    @property({
        min: 0,
        tooltip: 'Default animation duration in seconds.',
    })
    public duration = 0.5;

    @property({
        type: CCString,
        tooltip: 'Default tween easing name.',
    })
    public easing = 'sineInOut';

    @property({
        type: CCInteger,
        min: 0,
        max: 6,
        tooltip: 'Decimal places used in percentage text.',
    })
    public percentageDecimals = 0;

    @property({
        type: CCString,
        tooltip: 'Optional prefix before percentage text.',
    })
    public labelPrefix = '';

    @property({
        type: CCString,
        tooltip: 'Optional suffix after percentage number.',
    })
    public labelSuffix = '%';

    @property({
        tooltip: 'Hide percentage label node while progress is zero.',
    })
    public hideLabelAtZero = false;

    @property({
        tooltip: 'Set progress to fromProgress once on load.',
    })
    public setInitialProgressOnLoad = false;

    @property({
        tooltip: 'Stop current animation when component disables or destroys.',
    })
    public stopOnDisable = true;

    @property
    public debugLogs = false;

    private _activeTween: Tween<{ value: number }> | null = null;
    private _runToken = 0;
    private _lastTargetProgress = 1;

    protected onLoad(): void {
        if (!this.setInitialProgressOnLoad) {
            return;
        }

        this.setProgress(this.fromProgress);
    }

    protected onDisable(): void {
        if (!this.stopOnDisable) {
            return;
        }

        this.stop(false);
    }

    protected onDestroy(): void {
        if (!this.stopOnDisable) {
            return;
        }

        this.stop(false);
    }

    public setProgress(value: number): void {
        this._applyProgress(this._sanitizeProgress(value));
    }

    public play(): Promise<void> {
        return this.animateProgressTo(
            this.toProgress,
            this.duration,
            this.easing,
            this.fromProgress,
        );
    }

    public playNoWait(): void {
        this.animateProgressToNoWait(
            this.toProgress,
            this.duration,
            this.easing,
            this.fromProgress,
        );
    }

    public animateProgressToNoWait(
        toProgress?: number,
        duration?: number,
        easing?: string,
        fromProgress?: number,
    ): void {
        void this.animateProgressTo(toProgress, duration, easing, fromProgress);
    }

    public animateProgressTo(
        toProgress?: number,
        duration?: number,
        easing?: string,
        fromProgress?: number,
    ): Promise<void> {
        this._cancelActiveTween();
        this.fillAnimator?.stop(false);

        const token = this._runToken;
        const safeTo = this._sanitizeProgress(toProgress ?? this.toProgress);
        const safeDuration = this._sanitizeDuration(duration ?? this.duration);
        const safeEasing = this._sanitizeEasing(easing ?? this.easing);
        const currentProgress = this._readCurrentProgress();
        const safeFrom = fromProgress === undefined
            ? currentProgress
            : this._sanitizeProgress(fromProgress);

        this._lastTargetProgress = safeTo;
        this._applyProgress(safeFrom);

        if (safeDuration <= 0) {
            this._applyProgress(safeTo);
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const state = { value: safeFrom };

            this._activeTween = tween(state)
                .to(
                    safeDuration,
                    { value: safeTo },
                    {
                        easing: safeEasing,
                        onUpdate: (target) => {
                            if (token !== this._runToken) {
                                return;
                            }
                            this._applyProgress(target.value);
                        },
                    },
                )
                .call(() => {
                    if (token === this._runToken) {
                        this._activeTween = null;
                        this._applyProgress(safeTo);
                        this._log('Progress animation complete:', safeTo);
                    }
                    resolve();
                })
                .start();
        });
    }

    public stop(complete = false): void {
        this._cancelActiveTween();
        this.fillAnimator?.stop(false);

        if (!complete) {
            return;
        }

        this._applyProgress(this._lastTargetProgress);
        this._log('Progress animation stopped with completion:', this._lastTargetProgress);
    }

    private _cancelActiveTween(): void {
        this._runToken++;

        if (!this._activeTween) {
            return;
        }

        this._activeTween.stop();
        this._activeTween = null;
    }

    private _applyProgress(value: number): void {
        const safeValue = this._sanitizeProgress(value);

        if (this.fillAnimator) {
            this.fillAnimator.setFill(safeValue);
        } else if (this.fillSprite) {
            this.fillSprite.fillRange = safeValue;
        }

        this._updatePercentageLabel(safeValue);
    }

    private _updatePercentageLabel(progress: number): void {
        const label = this.percentageLabel;
        if (!label || !label.isValid) {
            return;
        }

        if (this.hideLabelAtZero) {
            label.node.active = Math.abs(progress) > 0;
        }

        const clampedDecimals = this._sanitizeDecimals(this.percentageDecimals);
        const percentage = (Math.abs(progress) * 100).toFixed(clampedDecimals);
        label.string = `${this.labelPrefix}${percentage}${this.labelSuffix}`;
    }

    private _readCurrentProgress(): number {
        if (this.fillAnimator && this.fillAnimator.fillSprite) {
            return this._sanitizeProgress(this.fillAnimator.fillSprite.fillRange);
        }

        if (this.fillSprite) {
            return this._sanitizeProgress(this.fillSprite.fillRange);
        }

        return this._sanitizeProgress(this.fromProgress);
    }

    private _sanitizeProgress(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(-1, Math.min(1, value));
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, value);
    }

    private _sanitizeEasing(value: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : 'linear';
    }

    private _sanitizeDecimals(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.min(6, Math.max(0, Math.round(value)));
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[SpriteFillProgressDisplay]', ...args);
    }
}
