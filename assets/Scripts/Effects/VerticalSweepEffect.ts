import {
    _decorator,
    CCString,
    Component,
    Node,
    tween,
    Tween,
    UITransform,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

export const VerticalSweepEffectEvent = {
    SWEEP_COMPLETE: 'sweep-complete',
} as const;

@ccclass('VerticalSweepEffect')
export class VerticalSweepEffect extends Component {
    @property({
        type: Node,
        tooltip: 'Node whose UITransform defines the sweep bounds. Defaults to this node.',
    })
    public boundsNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node that moves from top to bottom during the sweep.',
    })
    public sweepNode: Node | null = null;

    @property({
        min: 0,
        tooltip: 'Sweep duration in seconds.',
    })
    public duration = 0.3;

    @property({
        type: CCString,
        tooltip: 'Tween easing name for the sweep.',
    })
    public easing = 'sineInOut';

    @property({
        tooltip: 'Hide the sweep node when idle.',
    })
    public hideWhenIdle = true;

    @property
    public debugLogs = false;

    private _activeTween: Tween<Node> | null = null;
    private _isPlaying = false;
    private _runToken = 0;

    protected onLoad(): void {
        if (this.hideWhenIdle && this.sweepNode) {
            this.sweepNode.active = false;
        }
    }

    public get isPlaying(): boolean {
        return this._isPlaying;
    }

    public play(): Promise<void> {
        if (this._isPlaying) {
            return Promise.resolve();
        }

        const sweepNode = this.sweepNode;
        const boundsNode = this.boundsNode ?? this.node;
        const boundsTransform = boundsNode.getComponent(UITransform);

        if (!sweepNode || !boundsTransform) {
            return Promise.resolve();
        }

        this.stop();

        const token = ++this._runToken;
        this._isPlaying = true;
        sweepNode.active = true;

        const topY = boundsTransform.height * (1 - boundsTransform.anchorY);
        const bottomY = -boundsTransform.height * boundsTransform.anchorY;
        const centerX = boundsTransform.width * (0.5 - boundsTransform.anchorX);

        sweepNode.setPosition(centerX, topY, sweepNode.position.z);

        return new Promise<void>((resolve) => {
            if (this.duration <= 0) {
                sweepNode.setPosition(centerX, bottomY, sweepNode.position.z);
                this._finishSweep(token, resolve);
                return;
            }

            this._activeTween = tween(sweepNode)
                .to(
                    this.duration,
                    { position: new Vec3(centerX, bottomY, sweepNode.position.z) },
                    { easing: this._sanitizeEasing(this.easing) },
                )
                .call(() => {
                    this._finishSweep(token, resolve);
                })
                .start();
        });
    }

    public stop(): void {
        this._runToken++;

        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        this._isPlaying = false;

        if (this.hideWhenIdle && this.sweepNode) {
            this.sweepNode.active = false;
        }
    }

    private _finishSweep(token: number, resolve: () => void): void {
        if (token !== this._runToken) {
            resolve();
            return;
        }

        this._activeTween = null;
        this._isPlaying = false;

        if (this.hideWhenIdle && this.sweepNode) {
            this.sweepNode.active = false;
        }

        this.node.emit(VerticalSweepEffectEvent.SWEEP_COMPLETE);
        this._log('sweep-complete');
        resolve();
    }

    private _sanitizeEasing(value: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : 'linear';
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[VerticalSweepEffect]', ...args);
    }
}
