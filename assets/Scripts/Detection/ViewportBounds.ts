import {
    _decorator,
    Component,
    Enum,
    Rect,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

export enum OverlapMode {
    CenterInside = 0,
    OverlapPercent = 1,
}

Enum(OverlapMode);

@ccclass('ViewportBounds')
export class ViewportBounds extends Component {
    private readonly _worldRect = new Rect();

    public getWorldRect(out?: Rect): Rect {
        const uiTransform = this.node.getComponent(UITransform);
        if (!uiTransform) {
            if (out) {
                out.set(0, 0, 0, 0);
                return out;
            }
            return new Rect(0, 0, 0, 0);
        }

        const box = uiTransform.getBoundingBoxToWorld();
        if (out) {
            out.set(box);
            return out;
        }

        this._worldRect.set(box);
        return this._worldRect;
    }

    public containsPoint(worldPosition: Vec3): boolean {
        const rect = this.getWorldRect();
        return rect.contains(new Vec2(worldPosition.x, worldPosition.y));
    }

    public overlapsRect(
        other: Rect,
        mode: OverlapMode = OverlapMode.CenterInside,
        overlapThreshold = 0.35,
    ): boolean {
        const viewport = this.getWorldRect();

        if (mode === OverlapMode.CenterInside) {
            const centerX = other.x + other.width * 0.5;
            const centerY = other.y + other.height * 0.5;
            return viewport.contains(new Vec2(centerX, centerY));
        }

        const intersection = Rect.intersection(new Rect(), viewport, other);
        if (intersection.width <= 0 || intersection.height <= 0) {
            return false;
        }

        const intersectionArea = intersection.width * intersection.height;
        const otherArea = Math.max(1, other.width * other.height);
        return intersectionArea / otherArea >= overlapThreshold;
    }
}
