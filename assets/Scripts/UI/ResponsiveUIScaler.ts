import {
    _decorator,
    Component,
    Enum,
    UITransform,
    Vec2,
    Vec3,
    view,
    screen,
} from 'cc';

const { ccclass, property } = _decorator;

enum ScreenAnchor {
    Center = 0,

    Top,
    Bottom,
    Left,
    Right,

    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

Enum(ScreenAnchor);

enum ScaleMode {
    MatchWidthOrHeight = 0,
    FitInside,
    ExpandOutside,
}

Enum(ScaleMode);

@ccclass('ResponsiveUIScaler')
export class ResponsiveUIScaler extends Component {

    // -------------------------------------------------------------------------
    // Reference resolution / scaling
    // -------------------------------------------------------------------------

    @property({
        type: Vec2,
        tooltip: 'Your intended UI design resolution. Example: 1080x1920 for portrait-first playable ads.',
    })
    public referenceResolution: Vec2 = new Vec2(1080, 1920);

    @property({
        type: Enum(ScaleMode),
        tooltip: 'MatchWidthOrHeight works like Unity Canvas Scaler. FitInside uses the smaller scale. ExpandOutside uses the larger scale.',
    })
    public scaleMode: ScaleMode = ScaleMode.MatchWidthOrHeight;

    @property({
        range: [0, 1, 0.01],
        tooltip: 'Only used by MatchWidthOrHeight. 0 = match width, 1 = match height, 0.5 = balanced.',
    })
    public matchWidthOrHeight = 0.5;

    @property({
        tooltip: 'Uses this node scale at load time as the base scale.',
    })
    public captureCurrentScaleOnLoad = true;

    @property({
        type: Vec3,
        tooltip: 'Used as base scale only if Capture Current Scale On Load is disabled.',
    })
    public baseScale: Vec3 = new Vec3(1, 1, 1);

    @property({
        tooltip: 'Extra visual scale multiplier for portrait mode. This does NOT affect offset strength.',
    })
    public portraitScaleMultiplier = 1;

    @property({
        tooltip: 'Extra visual scale multiplier for landscape mode. This does NOT affect offset strength.',
    })
    public landscapeScaleMultiplier = 1;

    @property({
        tooltip: 'Minimum allowed final visual scale.',
    })
    public minScale = 0.1;

    @property({
        tooltip: 'Maximum allowed final visual scale.',
    })
    public maxScale = 10;

    // -------------------------------------------------------------------------
    // Positioning
    // -------------------------------------------------------------------------

    @property({
        type: Enum(ScreenAnchor),
        tooltip: 'Where this node should be placed in portrait mode, relative to its parent UITransform.',
    })
    public portraitAnchor: ScreenAnchor = ScreenAnchor.Center;

    @property({
        type: Vec3,
        tooltip: 'Portrait offset from the selected anchor. Z is ignored.',
    })
    public portraitOffset: Vec3 = new Vec3(0, 0, 0);

    @property({
        type: Enum(ScreenAnchor),
        tooltip: 'Where this node should be placed in landscape mode, relative to its parent UITransform.',
    })
    public landscapeAnchor: ScreenAnchor = ScreenAnchor.Center;

    @property({
        type: Vec3,
        tooltip: 'Landscape offset from the selected anchor. Z is ignored.',
    })
    public landscapeOffset: Vec3 = new Vec3(0, 0, 0);

    @property({
        tooltip: 'If enabled, offsets scale with screen size. They do NOT scale with portrait/landscape scale multipliers.',
    })
    public scaleOffsetsWithScreenScale = true;

    // -------------------------------------------------------------------------
    // Playable ad safety
    // -------------------------------------------------------------------------

    @property({
        tooltip: 'Useful for web/playable builds. Allows Cocos canvas to resize with browser/container size.',
    })
    public resizeWithBrowserSize = true;

    @property({
        tooltip: 'Recommended for playable ads. Some ad iframes resize without reliable orientation events.',
    })
    public checkSizeEveryFrame = true;

    private _runtimeBaseScale: Vec3 = new Vec3(1, 1, 1);
    private _runtimeScaleMultiplier: Vec3 = new Vec3(1, 1, 1);
    private _lastVisualScale = 1;

    private _lastParentWidth = -1;
    private _lastParentHeight = -1;
    private _lastIsPortrait = false;

    onLoad(): void {
        if (this.captureCurrentScaleOnLoad) {
            this._runtimeBaseScale.set(this.node.scale);
        } else {
            this._runtimeBaseScale.set(this.baseScale);
        }

        if (this.resizeWithBrowserSize) {
            view.resizeWithBrowserSize(true);
        }
    }

    onEnable(): void {
        screen.on('window-resize', this._onScreenChanged, this);
        screen.on('orientation-change', this._onScreenChanged, this);
        screen.on('fullscreen-change', this._onScreenChanged, this);

        this.applyLayout();

        this.scheduleOnce(() => {
            this.applyLayout();
        }, 0);
    }

    onDisable(): void {
        screen.off('window-resize', this._onScreenChanged, this);
        screen.off('orientation-change', this._onScreenChanged, this);
        screen.off('fullscreen-change', this._onScreenChanged, this);
    }

    update(): void {
        if (!this.checkSizeEveryFrame) {
            return;
        }

        const sizeInfo = this._getParentSizeInfo();

        const changed =
            Math.abs(sizeInfo.width - this._lastParentWidth) > 0.5 ||
            Math.abs(sizeInfo.height - this._lastParentHeight) > 0.5 ||
            sizeInfo.isPortrait !== this._lastIsPortrait;

        if (changed) {
            this.applyLayout();
        }
    }

    public applyLayout(): void {
        const sizeInfo = this._getParentSizeInfo();

        this._lastParentWidth = sizeInfo.width;
        this._lastParentHeight = sizeInfo.height;
        this._lastIsPortrait = sizeInfo.isPortrait;

        const screenScale = this._calculateScreenScale(
            sizeInfo.width,
            sizeInfo.height
        );

        const visualScale = this._calculateVisualScale(
            screenScale,
            sizeInfo.isPortrait
        );
        this._lastVisualScale = visualScale;

        this._applyScale(visualScale);
        this._applyPosition(sizeInfo, screenScale);
    }

    public setPortraitOffset(x: number, y: number): void {
        this.portraitOffset.x = x;
        this.portraitOffset.y = y;
        this.applyLayout();
    }

    public setLandscapeOffset(x: number, y: number): void {
        this.landscapeOffset.x = x;
        this.landscapeOffset.y = y;
        this.applyLayout();
    }

    public setPortraitScaleMultiplier(value: number): void {
        this.portraitScaleMultiplier = value;
        this.applyLayout();
    }

    public setLandscapeScaleMultiplier(value: number): void {
        this.landscapeScaleMultiplier = value;
        this.applyLayout();
    }

    public setRuntimeScaleMultiplier(multiplier: Vec3): void {
        const x = Number.isFinite(multiplier?.x) ? multiplier.x : 1;
        const y = Number.isFinite(multiplier?.y) ? multiplier.y : 1;
        const z = Number.isFinite(multiplier?.z) ? multiplier.z : 1;
        this._runtimeScaleMultiplier.set(x, y, z);
        this._applyScale(this._lastVisualScale);
    }

    public resetRuntimeScaleMultiplier(): void {
        this._runtimeScaleMultiplier.set(1, 1, 1);
        this._applyScale(this._lastVisualScale);
    }

    private _onScreenChanged(): void {
        this.applyLayout();

        this.scheduleOnce(() => {
            this.applyLayout();
        }, 0);
    }

    private _getParentSizeInfo(): {
        width: number;
        height: number;
        parentAnchorX: number;
        parentAnchorY: number;
        isPortrait: boolean;
    } {
        const parent = this.node.parent;
        const parentUI = parent?.getComponent(UITransform);

        let width: number;
        let height: number;
        let parentAnchorX = 0.5;
        let parentAnchorY = 0.5;

        if (parentUI) {
            width = parentUI.width;
            height = parentUI.height;
            parentAnchorX = parentUI.anchorX;
            parentAnchorY = parentUI.anchorY;
        } else {
            const visibleSize = view.getVisibleSize();
            width = visibleSize.width;
            height = visibleSize.height;
        }

        return {
            width,
            height,
            parentAnchorX,
            parentAnchorY,
            isPortrait: height >= width,
        };
    }

    private _calculateScreenScale(
        currentWidth: number,
        currentHeight: number
    ): number {
        const referenceWidth = Math.max(1, this.referenceResolution.x);
        const referenceHeight = Math.max(1, this.referenceResolution.y);

        const widthScale = currentWidth / referenceWidth;
        const heightScale = currentHeight / referenceHeight;

        switch (this.scaleMode) {
            case ScaleMode.FitInside:
                return Math.min(widthScale, heightScale);

            case ScaleMode.ExpandOutside:
                return Math.max(widthScale, heightScale);

            case ScaleMode.MatchWidthOrHeight:
            default:
                return this._logLerp(widthScale, heightScale, this.matchWidthOrHeight);
        }
    }

    private _calculateVisualScale(
        screenScale: number,
        isPortrait: boolean
    ): number {
        const orientationMultiplier = isPortrait
            ? this.portraitScaleMultiplier
            : this.landscapeScaleMultiplier;

        const finalScale = screenScale * orientationMultiplier;

        return this._clamp(finalScale, this.minScale, this.maxScale);
    }

    private _applyScale(visualScale: number): void {
        this.node.setScale(
            this._runtimeBaseScale.x * visualScale * this._runtimeScaleMultiplier.x,
            this._runtimeBaseScale.y * visualScale * this._runtimeScaleMultiplier.y,
            this._runtimeBaseScale.z * this._runtimeScaleMultiplier.z
        );
    }

    private _applyPosition(
        sizeInfo: {
            width: number;
            height: number;
            parentAnchorX: number;
            parentAnchorY: number;
            isPortrait: boolean;
        },
        screenScale: number
    ): void {
        const selectedAnchor = sizeInfo.isPortrait
            ? this.portraitAnchor
            : this.landscapeAnchor;

        const selectedOffset = sizeInfo.isPortrait
            ? this.portraitOffset
            : this.landscapeOffset;

        const anchor01 = this._getAnchor01(selectedAnchor);

        const offsetScale = this.scaleOffsetsWithScreenScale
            ? screenScale
            : 1;

        const x =
            (anchor01.x - sizeInfo.parentAnchorX) * sizeInfo.width +
            selectedOffset.x * offsetScale;

        const y =
            (anchor01.y - sizeInfo.parentAnchorY) * sizeInfo.height +
            selectedOffset.y * offsetScale;

        const currentZ = this.node.position.z;

        this.node.setPosition(x, y, currentZ);
    }

    private _getAnchor01(anchor: ScreenAnchor): Vec3 {
        switch (anchor) {
            case ScreenAnchor.Top:
                return new Vec3(0.5, 1, 0);

            case ScreenAnchor.Bottom:
                return new Vec3(0.5, 0, 0);

            case ScreenAnchor.Left:
                return new Vec3(0, 0.5, 0);

            case ScreenAnchor.Right:
                return new Vec3(1, 0.5, 0);

            case ScreenAnchor.TopLeft:
                return new Vec3(0, 1, 0);

            case ScreenAnchor.TopRight:
                return new Vec3(1, 1, 0);

            case ScreenAnchor.BottomLeft:
                return new Vec3(0, 0, 0);

            case ScreenAnchor.BottomRight:
                return new Vec3(1, 0, 0);

            case ScreenAnchor.Center:
            default:
                return new Vec3(0.5, 0.5, 0);
        }
    }

    private _logLerp(a: number, b: number, t: number): number {
        t = this._clamp01(t);

        if (a <= 0 || b <= 0) {
            return a + (b - a) * t;
        }

        return Math.pow(a, 1 - t) * Math.pow(b, t);
    }

    private _clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    private _clamp01(value: number): number {
        return this._clamp(value, 0, 1);
    }
}
