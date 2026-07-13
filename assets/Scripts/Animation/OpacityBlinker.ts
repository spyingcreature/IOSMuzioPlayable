import {
    _decorator,
    CCString,
    Color,
    Component,
    Node,
    Sprite,
    tween,
    Tween,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('OpacityBlinker')
export class OpacityBlinker extends Component {
    @property({
        type: Node,
        tooltip: 'Optional target node with a Sprite. If empty, this component node is used.',
    })
    public targetNode: Node | null = null;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Minimum opacity during the blink cycle (0 to 1).',
    })
    public minOpacity = 0.2;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Maximum opacity during the blink cycle (0 to 1).',
    })
    public maxOpacity = 1;

    @property({
        min: 0,
        tooltip: 'Duration in seconds for one full blink (fade down + fade up).',
    })
    public durationPerBlink = 0.6;

    @property({
        type: CCString,
        tooltip: 'Tween easing name used for both half-steps.',
    })
    public easing = 'sineInOut';

    @property({
        tooltip: 'Automatically start blinking when the component starts.',
    })
    public autoBlinkOnStart = false;

    @property({
        tooltip: 'Capture the sprite alpha on load as the restore target.',
    })
    public captureBaseOnLoad = true;

    @property({
        tooltip: 'Restore opacity when blinking is stopped.',
    })
    public restoreOpacityOnStop = true;

    @property({
        tooltip: 'When stopping, restore to the opacity captured on load instead of Restore To Opacity.',
    })
    public restoreToCapturedOpacity = true;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Opacity applied on stop when Restore To Captured Opacity is disabled.',
    })
    public restoreToOpacity = 1;

    @property
    public debugLogs = false;

    private _activeTween: Tween<Sprite> | null = null;
    private _runToken = 0;
    private _baseOpacity = 1;
    private _baseCaptured = false;

    protected onLoad(): void {
        if (this.captureBaseOnLoad) {
            this.captureBaseOpacity();
        }
    }

    protected start(): void {
        if (!this.autoBlinkOnStart) {
            return;
        }

        this.blink();
    }

    protected onDisable(): void {
        this.stopBlink(this.restoreOpacityOnStop);
    }

    protected onDestroy(): void {
        this.stopBlink(this.restoreOpacityOnStop);
    }

    public captureBaseOpacity(): void {
        const sprite = this._getSprite();
        if (!sprite) {
            return;
        }

        this._baseOpacity = sprite.color.a / 255;
        this._baseCaptured = true;
        this._log('Base opacity captured:', this._baseOpacity);
    }

    public blink(): void {
        const sprite = this._getSprite();
        if (!sprite) {
            return;
        }

        this.stopBlink(false);

        const safeMin = this._sanitizeOpacity(this.minOpacity);
        const safeMax = this._sanitizeOpacity(this.maxOpacity);
        const safeDuration = this._sanitizeDuration(this.durationPerBlink);
        const safeEasing = this._sanitizeEasing(this.easing);

        const currentColor = sprite.color;
        const dimColor = new Color(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            this._opacityToAlpha(safeMin),
        );
        const brightColor = new Color(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            this._opacityToAlpha(safeMax),
        );

        if (safeDuration <= 0) {
            sprite.color = dimColor;
            return;
        }

        const halfDuration = Math.max(0.001, safeDuration * 0.5);

        sprite.color = brightColor;

        this._activeTween = tween(sprite)
            .repeatForever(
                tween(sprite)
                    .to(halfDuration, { color: dimColor }, { easing: safeEasing })
                    .to(halfDuration, { color: brightColor }, { easing: safeEasing }),
            )
            .start();

        this._log('Blink started');
    }

    public stopBlink(restoreOpacity = true): void {
        this._runToken++;

        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        if (!restoreOpacity) {
            return;
        }

        const sprite = this._getSprite();
        if (!sprite) {
            return;
        }

        const targetOpacity = this.restoreToCapturedOpacity && this._baseCaptured
            ? this._baseOpacity
            : this._sanitizeOpacity(this.restoreToOpacity);

        this._setSpriteOpacity(sprite, targetOpacity);
        this._log('Blink stopped, opacity restored to:', targetOpacity);
    }

    private _getSprite(): Sprite | null {
        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            this._log('No valid target node');
            return null;
        }

        const sprite = target.getComponent(Sprite);
        if (!sprite) {
            this._log('No Sprite component on target node');
            return null;
        }

        return sprite;
    }

    private _opacityToAlpha(opacity: number): number {
        const clamped = Math.min(1, Math.max(0, opacity));
        return Math.round(clamped * 255);
    }

    private _setSpriteOpacity(sprite: Sprite, opacity: number): void {
        const currentColor = sprite.color;
        sprite.color = new Color(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            this._opacityToAlpha(opacity),
        );
    }

    private _sanitizeOpacity(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }

        return Math.min(1, Math.max(0, value));
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0.6;
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
        console.log('[OpacityBlinker]', ...args);
    }
}
