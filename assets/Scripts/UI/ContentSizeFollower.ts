import {
    _decorator,
    Component,
    Enum,
    Label,
    Node,
    UITransform,
    Vec2,
} from 'cc';

const { ccclass, property } = _decorator;

enum OffsetMode {
    Pixel = 0,
    Percent = 1,
}

Enum(OffsetMode);

@ccclass('ContentSizeFollower')
export class ContentSizeFollower extends Component {
    @property({
        type: Node,
        tooltip: 'Node whose UITransform size is watched. Defaults to the first Label in children.',
    })
    public sourceNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node to resize. Defaults to this component node.',
    })
    public targetNode: Node | null = null;

    @property({
        type: Enum(OffsetMode),
        tooltip: 'Whether padding values are pixels or a percentage of the source size.',
    })
    public offsetMode: OffsetMode = OffsetMode.Pixel;

    @property({
        tooltip: 'Use separate left/right/top/bottom padding instead of the uniform padding vector.',
    })
    public usePerSidePadding = false;

    @property({
        type: Vec2,
        tooltip: 'Uniform extra size. X = horizontal total, Y = vertical total.',
    })
    public padding = new Vec2(60, 44);

    @property({
        tooltip: 'Extra width on the left side. Used when Use Per Side Padding is enabled.',
    })
    public paddingLeft = 30;

    @property({
        tooltip: 'Extra width on the right side. Used when Use Per Side Padding is enabled.',
    })
    public paddingRight = 30;

    @property({
        tooltip: 'Extra height on the top side. Used when Use Per Side Padding is enabled.',
    })
    public paddingTop = 22;

    @property({
        tooltip: 'Extra height on the bottom side. Used when Use Per Side Padding is enabled.',
    })
    public paddingBottom = 22;

    @property({
        tooltip: 'Resize the target width to fit the source.',
    })
    public resizeWidth = true;

    @property({
        tooltip: 'Resize the target height to fit the source.',
    })
    public resizeHeight = true;

    @property({
        tooltip: 'Multiply source size by the source node scale before applying padding.',
    })
    public includeSourceScale = true;

    @property({
        type: Vec2,
        tooltip: 'Optional minimum target size.',
    })
    public minSize = new Vec2(0, 0);

    @property
    public debugLogs = false;

    private _resolvedSource: Node | null = null;
    private _resolvedTarget: Node | null = null;
    private _lastAppliedWidth = -1;
    private _lastAppliedHeight = -1;
    private _isListening = false;
    private _refreshScheduled = false;

    protected onEnable(): void {
        this._resolveNodes();
        this._resetAppliedCache();
        this._bindSizeListener();
        this._scheduleRefresh();
    }

    protected onDisable(): void {
        this._unbindSizeListener();
        this._refreshScheduled = false;
        this.unschedule(this._deferredRefresh);
    }

    protected start(): void {
        this._scheduleRefresh();
    }

    public refresh(): void {
        this._resolveNodes();
        this._syncSourceLabelLayout();
        this._applySize();
    }

    private _resetAppliedCache(): void {
        this._lastAppliedWidth = -1;
        this._lastAppliedHeight = -1;
    }

    private _scheduleRefresh(): void {
        if (this._refreshScheduled) {
            return;
        }

        this._refreshScheduled = true;
        this.scheduleOnce(this._deferredRefresh, 0);
    }

    private readonly _deferredRefresh = (): void => {
        this._refreshScheduled = false;
        this._syncSourceLabelLayout();
        this._applySize();
    };

    private _bindSizeListener(): void {
        if (!this._resolvedSource || this._isListening) {
            return;
        }

        this._resolvedSource.on(Node.EventType.SIZE_CHANGED, this._onSourceSizeChanged, this);
        this._isListening = true;
    }

    private _unbindSizeListener(): void {
        if (!this._resolvedSource || !this._isListening) {
            return;
        }

        this._resolvedSource.off(Node.EventType.SIZE_CHANGED, this._onSourceSizeChanged, this);
        this._isListening = false;
    }

    private _onSourceSizeChanged(): void {
        if (this._isSelfResizeEcho()) {
            return;
        }

        this._scheduleRefresh();
    }

    private _syncSourceLabelLayout(): void {
        const sourceNode = this._resolvedSource;
        if (!sourceNode) {
            return;
        }

        const label = sourceNode.getComponent(Label)
            ?? sourceNode.getComponentInChildren(Label);
        if (!label) {
            return;
        }

        label.updateRenderData(true);
    }

    private _isSelfResizeEcho(): boolean {
        if (
            this._resolvedSource !== this._resolvedTarget
            || this._lastAppliedWidth < 0
            || this._lastAppliedHeight < 0
        ) {
            return false;
        }

        const targetTransform = this._resolvedTarget?.getComponent(UITransform);
        if (!targetTransform) {
            return false;
        }

        return Math.abs(targetTransform.width - this._lastAppliedWidth) < 0.001
            && Math.abs(targetTransform.height - this._lastAppliedHeight) < 0.001;
    }

    private _resolveNodes(): void {
        const nextSource = this.sourceNode ?? this._findDefaultSourceNode();
        const nextTarget = this.targetNode ?? this.node;

        if (nextSource !== this._resolvedSource) {
            this._unbindSizeListener();
            this._resolvedSource = nextSource;
            this._bindSizeListener();
        }

        this._resolvedTarget = nextTarget;
    }

    private _findDefaultSourceNode(): Node | null {
        const label = this.node.getComponentInChildren(Label);
        return label?.node ?? null;
    }

    private _applySize(): void {
        const sourceNode = this._resolvedSource;
        const targetNode = this._resolvedTarget;

        if (!sourceNode || !targetNode) {
            this._log('missing source or target node');
            return;
        }

        const sourceTransform = sourceNode.getComponent(UITransform);
        const targetTransform = targetNode.getComponent(UITransform);

        if (!sourceTransform || !targetTransform) {
            this._log('missing UITransform on source or target');
            return;
        }

        const scaleX = this.includeSourceScale ? Math.abs(sourceNode.scale.x) : 1;
        const scaleY = this.includeSourceScale ? Math.abs(sourceNode.scale.y) : 1;
        const sourceWidth = sourceTransform.width * scaleX;
        const sourceHeight = sourceTransform.height * scaleY;

        const extraWidth = this._computeExtraWidth(sourceWidth);
        const extraHeight = this._computeExtraHeight(sourceHeight);

        const nextWidth = this.resizeWidth
            ? Math.max(this.minSize.x, sourceWidth + extraWidth)
            : targetTransform.width;
        const nextHeight = this.resizeHeight
            ? Math.max(this.minSize.y, sourceHeight + extraHeight)
            : targetTransform.height;

        if (
            Math.abs(nextWidth - this._lastAppliedWidth) < 0.001
            && Math.abs(nextHeight - this._lastAppliedHeight) < 0.001
        ) {
            return;
        }

        targetTransform.setContentSize(nextWidth, nextHeight);
        this._lastAppliedWidth = nextWidth;
        this._lastAppliedHeight = nextHeight;

        this._log(
            'applied',
            nextWidth.toFixed(2),
            'x',
            nextHeight.toFixed(2),
            'from source',
            sourceWidth.toFixed(2),
            'x',
            sourceHeight.toFixed(2),
        );
    }

    private _computeExtraWidth(sourceWidth: number): number {
        if (this.offsetMode === OffsetMode.Pixel) {
            return this.usePerSidePadding
                ? this.paddingLeft + this.paddingRight
                : this.padding.x;
        }

        const percent = this.usePerSidePadding
            ? this.paddingLeft + this.paddingRight
            : this.padding.x;

        return sourceWidth * percent / 100;
    }

    private _computeExtraHeight(sourceHeight: number): number {
        if (this.offsetMode === OffsetMode.Pixel) {
            return this.usePerSidePadding
                ? this.paddingTop + this.paddingBottom
                : this.padding.y;
        }

        const percent = this.usePerSidePadding
            ? this.paddingTop + this.paddingBottom
            : this.padding.y;

        return sourceHeight * percent / 100;
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }

        console.log('[ContentSizeFollower]', ...args);
    }
}
