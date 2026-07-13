import {
    _decorator,
    Component,
    EventHandler,
    EventTouch,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import { DragBoundsClamp } from './DragBoundsClamp';

const { ccclass, property } = _decorator;

export const DraggableNode2DEvent = {
    DRAG_START: 'drag-start',
    DRAG_MOVE: 'drag-move',
    DRAG_END: 'drag-end',
} as const;

@ccclass('DraggableNode2D')
export class DraggableNode2D extends Component {
    @property({
        type: Node,
        tooltip: 'Optional larger touch target. Defaults to this node.',
    })
    public dragHandle: Node | null = null;

    @property({
        type: DragBoundsClamp,
        tooltip: 'Optional clamp component to keep the dragged node inside bounds.',
    })
    public boundsClamp: DragBoundsClamp | null = null;

    @property({
        tooltip: 'When false, touch input is ignored.',
    })
    public dragEnabled = true;

    @property({
        type: [EventHandler],
        tooltip: 'Invoked only the first time this draggable is touched.',
    })
    public firstTouchEvents: EventHandler[] = [];

    @property
    public debugLogs = false;

    private readonly _touchOffset = new Vec3();
    private readonly _localPosition = new Vec3();
    private _isDragging = false;
    private _activeTouchId = -1;
    private _hasFiredFirstTouch = false;
    private _boundHandle: Node | null = null;

    protected onEnable(): void {
        this._bindHandle(this._getDragHandle());
    }

    protected onDisable(): void {
        this._unbindHandle();
        this._resetDragState();
    }

    public setDragEnabled(enabled: boolean): void {
        this.dragEnabled = enabled;
        if (!enabled) {
            this._resetDragState();
        }
    }

    public get isDragging(): boolean {
        return this._isDragging;
    }

    private _onTouchStart(event: EventTouch): void {
        if (!this.dragEnabled) {
            return;
        }

        if (this._isDragging && this._activeTouchId !== event.getID()) {
            return;
        }

        const parentTransform = this.node.parent?.getComponent(UITransform);
        if (!parentTransform) {
            return;
        }

        const uiLocation = event.getUILocation();
        const localPoint = parentTransform.convertToNodeSpaceAR(
            new Vec3(uiLocation.x, uiLocation.y, 0),
        );

        this._touchOffset.set(
            this.node.position.x - localPoint.x,
            this.node.position.y - localPoint.y,
            0,
        );

        this._isDragging = true;
        this._activeTouchId = event.getID();
        if (!this._hasFiredFirstTouch) {
            this._hasFiredFirstTouch = true;
            EventHandler.emitEvents(this.firstTouchEvents, event);
        }
        this.node.emit(DraggableNode2DEvent.DRAG_START);
        this._log('drag-start');
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this.dragEnabled || !this._isDragging) {
            return;
        }

        if (this._activeTouchId !== event.getID()) {
            return;
        }

        const parentTransform = this.node.parent?.getComponent(UITransform);
        if (!parentTransform) {
            return;
        }

        const uiLocation = event.getUILocation();
        const localPoint = parentTransform.convertToNodeSpaceAR(
            new Vec3(uiLocation.x, uiLocation.y, 0),
        );

        this._localPosition.set(
            localPoint.x + this._touchOffset.x,
            localPoint.y + this._touchOffset.y,
            this.node.position.z,
        );

        if (this.boundsClamp) {
            const clamped = this.boundsClamp.clampPosition(
                this._localPosition,
                this.node,
            );
            this._localPosition.set(clamped);
        }

        this.node.setPosition(this._localPosition);
        this.node.emit(DraggableNode2DEvent.DRAG_MOVE, this._localPosition.clone());
    }

    private _onTouchEnd(event: EventTouch): void {
        if (!this._isDragging || this._activeTouchId !== event.getID()) {
            return;
        }

        this._resetDragState();
        this.node.emit(DraggableNode2DEvent.DRAG_END);
        this._log('drag-end');
    }

    private _resetDragState(): void {
        this._isDragging = false;
        this._activeTouchId = -1;
    }

    private _getDragHandle(): Node {
        return this.dragHandle ?? this.node;
    }

    private _bindHandle(handle: Node): void {
        this._boundHandle = handle;
        handle.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        handle.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        handle.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        handle.on(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
    }

    private _unbindHandle(): void {
        const handle = this._boundHandle;
        if (!handle) {
            return;
        }

        handle.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        handle.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        handle.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        handle.off(Node.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        this._boundHandle = null;
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[DraggableNode2D]', ...args);
    }
}
