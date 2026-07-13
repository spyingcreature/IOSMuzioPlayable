import {
    _decorator,
    CCString,
    Component,
    Node,
    Sprite,
    tween,
    Tween,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('SpriteFillAnimator')
export class SpriteFillAnimator extends Component {
    @property({
        type: Node,
        tooltip: 'Optional target node with Sprite. If empty, this component node is used.',
    })
    public targetNode: Node | null = null;

    @property({
        type: Sprite,
        tooltip: 'Optional direct Sprite reference. If set, this is used before target node lookup.',
    })
    public fillSprite: Sprite | null = null;

    @property({
        min: -1,
        max: 1,
        tooltip: 'Default starting fill value (-1..1) used by play(). Negative values reverse direction.',
    })
    public fromFill = 0;

    @property({
        min: -1,
        max: 1,
        tooltip: 'Default ending fill value (-1..1). Negative values reverse direction.',
    })
    public toFill = 1;

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
        tooltip: 'Set fill to fromFill once on load.',
    })
    public setInitialFillOnLoad = false;

    @property({
        tooltip: 'Stop current animation when component disables or destroys.',
    })
    public stopOnDisable = true;

    @property
    public debugLogs = false;

    private _activeTween: Tween<{ value: number }> | null = null;
    private _runToken = 0;
    private _lastTargetFill = 1;

    protected onLoad(): void {
        if (!this.setInitialFillOnLoad) {
            return;
        }

        this.setFill(this.fromFill);
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

    public setFill(value: number): void {
        const sprite = this._getSprite();
        if (!sprite) {
            return;
        }

        this._setSpriteFill(sprite, value);
    }

    public play(): Promise<void> {
        return this.animateTo(this.toFill, this.duration, this.easing, this.fromFill);
    }

    public playNoWait(): void {
        this.animateToNoWait(this.toFill, this.duration, this.easing, this.fromFill);
    }

    public animateToNoWait(
        toFill?: number,
        duration?: number,
        easing?: string,
        fromFill?: number,
    ): void {
        void this.animateTo(toFill, duration, easing, fromFill);
    }

    public animateTo(
        toFill?: number,
        duration?: number,
        easing?: string,
        fromFill?: number,
    ): Promise<void> {
        const sprite = this._getSprite();
        if (!sprite) {
            return Promise.resolve();
        }

        this._cancelActiveTween();

        const token = this._runToken;
        const safeTo = this._sanitizeFill(toFill ?? this.toFill);
        const safeDuration = this._sanitizeDuration(duration ?? this.duration);
        const safeEasing = this._sanitizeEasing(easing ?? this.easing);
        const safeFrom = fromFill === undefined
            ? this._sanitizeFill(sprite.fillRange)
            : this._sanitizeFill(fromFill);

        this._lastTargetFill = safeTo;
        this._setSpriteFill(sprite, safeFrom);

        if (safeDuration <= 0) {
            this._setSpriteFill(sprite, safeTo);
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
                            this._setSpriteFill(sprite, target.value);
                        },
                    },
                )
                .call(() => {
                    if (token === this._runToken) {
                        this._setSpriteFill(sprite, safeTo);
                        this._activeTween = null;
                        this._log('Animation complete:', safeTo);
                    }
                    resolve();
                })
                .start();
        });
    }

    public stop(complete = false): void {
        const sprite = this._getSprite();
        this._cancelActiveTween();

        if (!complete || !sprite) {
            return;
        }

        this._setSpriteFill(sprite, this._lastTargetFill);
        this._log('Animation stopped with completion:', this._lastTargetFill);
    }

    private _cancelActiveTween(): void {
        this._runToken++;

        if (!this._activeTween) {
            return;
        }

        this._activeTween.stop();
        this._activeTween = null;
    }

    private _getSprite(): Sprite | null {
        if (this.fillSprite) {
            return this.fillSprite.isValid ? this.fillSprite : null;
        }

        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            this._log('No valid target node');
            return null;
        }

        const sprite = target.getComponent(Sprite);
        if (!sprite) {
            this._log('No Sprite on target node');
            return null;
        }

        return sprite;
    }

    private _setSpriteFill(sprite: Sprite, value: number): void {
        sprite.fillRange = this._sanitizeFill(value);
    }

    private _sanitizeFill(value: number): number {
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

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[SpriteFillAnimator]', ...args);
    }
}
