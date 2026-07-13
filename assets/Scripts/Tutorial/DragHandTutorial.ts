import {
    _decorator,
    Component,
    Node,
    tween,
    Tween,
    Vec3,
} from 'cc';
import { DraggableNode2D, DraggableNode2DEvent } from '../Input/DraggableNode2D';

const { ccclass, property } = _decorator;

@ccclass('DragHandTutorial')
export class DragHandTutorial extends Component {
    @property({
        type: DraggableNode2D,
        tooltip: 'Draggable that dismisses this tutorial on first drag.',
    })
    public draggable: DraggableNode2D | null = null;

    @property({
        type: Node,
        tooltip: 'Hand indicator node. Defaults to this node.',
    })
    public handNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node to animate as a drag hint. Usually the same as the draggable node.',
    })
    public hintTarget: Node | null = null;

    @property({
        type: Vec3,
        tooltip: 'Local offset applied while animating the hint target.',
    })
    public hintOffset = new Vec3(120, 0, 0);

    @property({
        min: 0,
        tooltip: 'Duration for one half of the hint tween.',
    })
    public hintDuration = 0.6;

    @property({
        min: 0,
        tooltip: 'Pause between hint loops.',
    })
    public loopDelay = 0.2;

    @property({
        tooltip: 'Hide the hand node when the tutorial is dismissed.',
    })
    public hideHandOnDismiss = true;

    @property
    public debugLogs = false;

    private _hintTween: Tween<Node> | null = null;
    private _basePosition = new Vec3();
    private _dismissed = false;
    private _dragStartHandler: (() => void) | null = null;

    protected onEnable(): void {
        const hand = this._getHandNode();
        hand.active = true;

        const hintTarget = this.hintTarget;
        if (hintTarget) {
            this._basePosition.set(hintTarget.position);
            this._startHintLoop();
        }

        const draggableNode = this.draggable?.node;
        if (draggableNode) {
            this._dragStartHandler = () => {
                this.dismiss();
            };
            draggableNode.on(DraggableNode2DEvent.DRAG_START, this._dragStartHandler, this);
        }
    }

    protected onDisable(): void {
        this._stopHintLoop();

        const draggableNode = this.draggable?.node;
        if (draggableNode && this._dragStartHandler) {
            draggableNode.off(DraggableNode2DEvent.DRAG_START, this._dragStartHandler, this);
            this._dragStartHandler = null;
        }
    }

    public dismiss(): void {
        if (this._dismissed) {
            return;
        }

        this._dismissed = true;
        this._stopHintLoop();

        if (this.hintTarget) {
            this.hintTarget.setPosition(this._basePosition);
        }

        if (this.hideHandOnDismiss) {
            this._getHandNode().active = false;
        }

        this._log('dismissed');
    }

    private _startHintLoop(): void {
        const hintTarget = this.hintTarget;
        if (!hintTarget || this._dismissed) {
            return;
        }

        const left = new Vec3(
            this._basePosition.x - this.hintOffset.x,
            this._basePosition.y - this.hintOffset.y,
            this._basePosition.z,
        );
        const right = new Vec3(
            this._basePosition.x + this.hintOffset.x,
            this._basePosition.y + this.hintOffset.y,
            this._basePosition.z,
        );

        hintTarget.setPosition(left);

        this._hintTween = tween(hintTarget)
            .repeatForever(
                tween()
                    .to(this.hintDuration, { position: right })
                    .delay(this.loopDelay)
                    .to(this.hintDuration, { position: left })
                    .delay(this.loopDelay),
            )
            .start();
    }

    private _stopHintLoop(): void {
        if (this._hintTween) {
            this._hintTween.stop();
            this._hintTween = null;
        }
    }

    private _getHandNode(): Node {
        return this.handNode ?? this.node;
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[DragHandTutorial]', ...args);
    }
}
