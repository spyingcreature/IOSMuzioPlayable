import {
    _decorator,
    CCString,
    Color,
    Component,
    Node,
    Sprite,
    tween,
    Tween,
    UIOpacity,
    UITransform,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('NodeFadeAnimator')
export class NodeFadeAnimator extends Component {
    @property({
        type: Node,
        tooltip: 'Optional target node to fade. If empty, this component node is used.',
    })
    public targetNode: Node | null = null;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Default starting opacity value (0..1) used by fadeIn()/fadeTo().',
    })
    public fromOpacity = 0;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Default ending opacity value (0..1) used by fadeOut()/fadeTo().',
    })
    public toOpacity = 1;

    @property({
        min: 0,
        tooltip: 'Default fade duration in seconds.',
    })
    public duration = 0.3;

    @property({
        type: CCString,
        tooltip: 'Default tween easing name.',
    })
    public easing = 'sineOut';

    @property({
        tooltip: 'Prefer fading with UIOpacity when available on the target node.',
    })
    public useUIOpacityWhenAvailable = true;

    @property({
        tooltip: 'Add UIOpacity to the target when it has UITransform but no UIOpacity.',
    })
    public addUIOpacityIfMissing = true;

    @property({
        tooltip: 'Set opacity to From Opacity once on load.',
    })
    public setInitialOpacityOnLoad = false;

    @property({
        tooltip: 'Stop active fade when this component is disabled or destroyed.',
    })
    public stopOnDisable = true;

    @property
    public debugLogs = false;

    private _activeTween: Tween<{ value: number }> | null = null;
    private _runToken = 0;
    private _lastTargetOpacity = 1;

    protected onLoad(): void {
        if (!this.setInitialOpacityOnLoad) {
            return;
        }

        this.setOpacity(this.fromOpacity);
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

    public setOpacity(opacity: number): void {
        this._applyOpacity(this._sanitizeOpacity(opacity));
    }

    public fadeToNoWait(
        toOpacity?: number,
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): void {
        void this.fadeTo(toOpacity, duration, easing, fromOpacity);
    }

    public fadeTo(
        toOpacity?: number,
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): Promise<void> {
        this._cancelActiveTween();

        const token = this._runToken;
        const safeTo = this._sanitizeOpacity(toOpacity ?? this.toOpacity);
        const safeDuration = this._sanitizeDuration(duration ?? this.duration);
        const safeEasing = this._sanitizeEasing(easing ?? this.easing);
        const safeFrom = fromOpacity === undefined
            ? this._getCurrentOpacity()
            : this._sanitizeOpacity(fromOpacity);

        this._lastTargetOpacity = safeTo;
        this._applyOpacity(safeFrom);

        if (safeDuration <= 0) {
            this._applyOpacity(safeTo);
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

                            this._applyOpacity(target.value);
                        },
                    },
                )
                .call(() => {
                    if (token === this._runToken) {
                        this._applyOpacity(safeTo);
                        this._activeTween = null;
                        this._log('Fade complete:', safeTo);
                    }

                    resolve();
                })
                .start();
        });
    }

    public fadeIn(
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): Promise<void> {
        return this.fadeTo(1, duration, easing, fromOpacity ?? this.fromOpacity);
    }

    public fadeOut(
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): Promise<void> {
        const startValue = fromOpacity === undefined
            ? this.toOpacity
            : fromOpacity;
        return this.fadeTo(0, duration, easing, startValue);
    }

    public fadeInNoWait(
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): void {
        void this.fadeIn(duration, easing, fromOpacity);
    }

    public fadeOutNoWait(
        duration?: number,
        easing?: string,
        fromOpacity?: number,
    ): void {
        void this.fadeOut(duration, easing, fromOpacity);
    }

    public stop(complete = false): void {
        this._cancelActiveTween();

        if (!complete) {
            return;
        }

        this._applyOpacity(this._lastTargetOpacity);
        this._log('Fade stopped with completion:', this._lastTargetOpacity);
    }

    private _cancelActiveTween(): void {
        this._runToken++;

        if (!this._activeTween) {
            return;
        }

        this._activeTween.stop();
        this._activeTween = null;
    }

    private _getTargetNode(): Node | null {
        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            this._log('No valid target node');
            return null;
        }

        return target;
    }

    private _getCurrentOpacity(): number {
        const uiOpacity = this._resolveUIOpacity(false);
        if (uiOpacity) {
            return this._alphaToOpacity(uiOpacity.opacity);
        }

        const sprite = this._resolveSprite();
        if (sprite) {
            return this._alphaToOpacity(sprite.color.a);
        }

        return this._sanitizeOpacity(this.fromOpacity);
    }

    private _applyOpacity(opacity: number): void {
        const safeOpacity = this._sanitizeOpacity(opacity);
        const uiOpacity = this._resolveUIOpacity(true);
        if (uiOpacity) {
            uiOpacity.opacity = this._opacityToAlpha(safeOpacity);
            return;
        }

        const sprite = this._resolveSprite();
        if (sprite) {
            const color = sprite.color;
            sprite.color = new Color(
                color.r,
                color.g,
                color.b,
                this._opacityToAlpha(safeOpacity),
            );
            return;
        }

        this._log('No UIOpacity or Sprite target found for fade');
    }

    private _resolveUIOpacity(allowAdd: boolean): UIOpacity | null {
        if (!this.useUIOpacityWhenAvailable) {
            return null;
        }

        const target = this._getTargetNode();
        if (!target) {
            return null;
        }

        const existing = target.getComponent(UIOpacity);
        if (existing) {
            return existing;
        }

        if (!allowAdd || !this.addUIOpacityIfMissing) {
            return null;
        }

        const hasUiShape = !!target.getComponent(UITransform);
        if (!hasUiShape) {
            return null;
        }

        return target.addComponent(UIOpacity);
    }

    private _resolveSprite(): Sprite | null {
        const target = this._getTargetNode();
        if (!target) {
            return null;
        }

        return target.getComponent(Sprite);
    }

    private _sanitizeOpacity(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }

        return Math.max(0, Math.min(1, value));
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

    private _opacityToAlpha(value: number): number {
        return Math.round(this._sanitizeOpacity(value) * 255);
    }

    private _alphaToOpacity(value: number): number {
        if (!Number.isFinite(value)) {
            return this._sanitizeOpacity(this.fromOpacity);
        }

        return this._sanitizeOpacity(value / 255);
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }

        console.log('[NodeFadeAnimator]', ...args);
    }
}
