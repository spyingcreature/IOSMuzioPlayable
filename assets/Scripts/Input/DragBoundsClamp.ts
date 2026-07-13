import {
    _decorator,
    Component,
    Node,
    UITransform,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('DragBoundsClamp')
export class DragBoundsClamp extends Component {
    @property({
        type: Node,
        tooltip: 'Optional bounds root. Uses this node UITransform if set; otherwise uses parent UITransform.',
    })
    public boundsRoot: Node | null = null;

    @property({
        tooltip: 'Extra padding subtracted from each edge of the bounds rect.',
    })
    public edgePadding = 0;

    private readonly _clamped = new Vec3();

    public clampPosition(
        localPosition: Vec3,
        draggedNode: Node,
    ): Vec3 {
        const boundsTransform = this._getBoundsTransform();
        const draggedTransform = draggedNode.getComponent(UITransform);

        if (!boundsTransform || !draggedTransform) {
            this._clamped.set(localPosition);
            return this._clamped;
        }

        const halfWidth = draggedTransform.width * draggedTransform.anchorX;
        const halfWidthRight = draggedTransform.width * (1 - draggedTransform.anchorX);
        const halfHeight = draggedTransform.height * draggedTransform.anchorY;
        const halfHeightTop = draggedTransform.height * (1 - draggedTransform.anchorY);

        const padding = Math.max(0, this.edgePadding);
        const minX = -boundsTransform.width * boundsTransform.anchorX + halfWidth + padding;
        const maxX = boundsTransform.width * (1 - boundsTransform.anchorX) - halfWidthRight - padding;
        const minY = -boundsTransform.height * boundsTransform.anchorY + halfHeight + padding;
        const maxY = boundsTransform.height * (1 - boundsTransform.anchorY) - halfHeightTop - padding;

        this._clamped.set(
            this._clamp(localPosition.x, minX, maxX),
            this._clamp(localPosition.y, minY, maxY),
            localPosition.z,
        );

        return this._clamped;
    }

    private _getBoundsTransform(): UITransform | null {
        const root = this.boundsRoot ?? this.node.parent;
        return root?.getComponent(UITransform) ?? null;
    }

    private _clamp(value: number, min: number, max: number): number {
        if (min > max) {
            return (min + max) * 0.5;
        }
        return Math.min(Math.max(value, min), max);
    }
}
