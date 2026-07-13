import {
    _decorator,
    Color,
    Component,
    Label,
    Node,
    Sprite,
    tween,
    Tween,
} from 'cc';
import { NodePopInOut } from '../Animation/NodePopInOut';
import {
    PlayableEvent,
    PlayableEvents,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

export const RevealPanelControllerEvent = {
    PANEL_SHOWN: 'panel-shown',
} as const;

@ccclass('RevealPanelController')
export class RevealPanelController extends Component {
    @property({
        type: Node,
        tooltip: 'Root node toggled active when show() is called. Defaults to this node.',
    })
    public rootNode: Node | null = null;

    @property({
        type: Label,
        tooltip: 'Optional title label whose text can be set before reveal.',
    })
    public titleLabel: Label | null = null;

    @property({
        tooltip: 'Title text applied on show() when titleLabel is assigned.',
    })
    public titleText = '';

    @property({
        type: [Node],
        tooltip: 'Content nodes revealed in order with NodePopInOut when available.',
    })
    public contentNodes: Node[] = [];

    @property({
        min: 0,
        tooltip: 'Delay before the panel becomes active.',
    })
    public showDelay = 0;

    @property({
        min: 0,
        tooltip: 'Delay between each content node reveal.',
    })
    public contentStagger = 0.2;

    @property({
        tooltip: 'Start with the root inactive.',
    })
    public startHidden = true;

    @property({
        type: Node,
        tooltip: 'Optional background node whose Sprite color alpha fades in on show().',
    })
    public backgroundNode: Node | null = null;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Target Sprite color alpha on show(), as a value between 0 and 1.',
    })
    public backgroundTargetOpacity = 0.6;

    @property({
        min: 0,
        tooltip: 'Duration in seconds for the background opacity fade.',
    })
    public backgroundFadeDuration = 0.3;

    @property
    public debugLogs = false;

    private _isShowing = false;
    private _bgTween: Tween<Sprite> | null = null;

    protected onLoad(): void {
        if (this.startHidden) {
            const root = this._getRoot();
            root.active = false;
            this._setBackgroundAlpha(0);
        }
    }

    protected onDisable(): void {
        this._stopBackgroundTween();
    }

    public async show(): Promise<void> {
        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'RevealPanelController.ts:show',message:'end panel show called',data:{nodeName:this.node.name,isShowing:this._isShowing},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        if (this._isShowing) {
            return;
        }

        this._isShowing = true;

        if (this.showDelay > 0) {
            await this._wait(this.showDelay);
        }

        const root = this._getRoot();
        root.active = true;

        if (this.titleLabel && this.titleText) {
            this.titleLabel.string = this.titleText;
        }

        this._fadeInBackground();

        await this._revealContentNodes();

        this.node.emit(RevealPanelControllerEvent.PANEL_SHOWN);
        PlayableEvents.emit(PlayableEvent.PANEL_SHOWN);
        this._log('panel shown');
    }

    public hide(): void {
        this._stopBackgroundTween();
        this._setBackgroundAlpha(0);
        this._getRoot().active = false;
        this._isShowing = false;
    }

    private async _revealContentNodes(): Promise<void> {
        for (let i = 0; i < this.contentNodes.length; i += 1) {
            const contentNode = this.contentNodes[i];
            if (!contentNode || !contentNode.isValid) {
                continue;
            }

            contentNode.active = true;

            const popIn = contentNode.getComponent(NodePopInOut)
                ?? contentNode.getComponentInChildren(NodePopInOut);

            if (popIn) {
                await popIn.popIn(true);
            }

            if (this.contentStagger > 0 && i < this.contentNodes.length - 1) {
                await this._wait(this.contentStagger);
            }
        }
    }

    private _getRoot(): Node {
        return this.rootNode ?? this.node;
    }

    private _getBackgroundSprite(): Sprite | null {
        if (!this.backgroundNode || !this.backgroundNode.isValid) {
            return null;
        }

        return this.backgroundNode.getComponent(Sprite)
            ?? this.backgroundNode.getComponentInChildren(Sprite);
    }

    private _fadeInBackground(): void {
        const sprite = this._getBackgroundSprite();
        if (!sprite) {
            return;
        }

        if (this.backgroundNode && !this.backgroundNode.active) {
            this.backgroundNode.active = true;
        }

        this._stopBackgroundTween();

        const targetAlpha = this._opacityToAlpha(this.backgroundTargetOpacity);
        const currentColor = sprite.color;
        const targetColor = new Color(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            targetAlpha,
        );

        if (this.backgroundFadeDuration <= 0) {
            sprite.color = targetColor;
            return;
        }

        this._bgTween = tween(sprite)
            .to(
                this.backgroundFadeDuration,
                { color: targetColor },
                { easing: 'sineOut' },
            )
            .call(() => {
                this._bgTween = null;
            })
            .start();
    }

    private _setBackgroundAlpha(opacity: number): void {
        const sprite = this._getBackgroundSprite();
        if (!sprite) {
            return;
        }

        const currentColor = sprite.color;
        sprite.color = new Color(
            currentColor.r,
            currentColor.g,
            currentColor.b,
            this._opacityToAlpha(opacity),
        );
    }

    private _opacityToAlpha(opacity: number): number {
        const clamped = Math.min(1, Math.max(0, opacity));
        return Math.round(clamped * 255);
    }

    private _stopBackgroundTween(): void {
        if (!this._bgTween) {
            return;
        }

        this._bgTween.stop();
        this._bgTween = null;
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
        console.log('[RevealPanelController]', ...args);
    }
}
