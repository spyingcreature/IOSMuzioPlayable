import {
    _decorator,
    Component,
    Node,
    Rect,
    tween,
    Tween,
    UITransform,
    Vec3,
} from 'cc';
import {
    DraggableNode2D,
    DraggableNode2DEvent,
} from '../Input/DraggableNode2D';
import { MuzioMood, normalizeMuzioMood } from './MuzioPlayableEvents';
import type { MuzioPlaylistController } from './MuzioPlaylistController';

const { ccclass, property } = _decorator;

/**
 * Sprite-only draggable song card.
 *
 * Prefab requirements:
 * - Sprite on this node (or a child node) containing the complete song-card image.
 * - UITransform on this node.
 * - DraggableNode2D on this node.
 * - PlaylistSongCard on this node.
 *
 * The song title and artist are already baked into the assigned SpriteFrame,
 * so this component does not manage labels or text.
 */
@ccclass('PlaylistSongCard')
export class PlaylistSongCard extends Component {
    @property({
        tooltip: 'Mood group this card belongs to: Relax, Energy, or Focus.',
    })
    public mood = 'Relax';

    @property({ type: DraggableNode2D })
    public draggable: DraggableNode2D | null = null;

    @property
    public dragScale = 1.04;

    @property({ min: 0 })
    public snapDuration = 0.18;

    @property({ min: 0 })
    public returnDuration = 0.18;

    @property
    public debugLogs = false;

    public get normalizedMood(): MuzioMood | null {
        return normalizeMuzioMood(this.mood);
    }

    public get isAccepted(): boolean {
        return this._accepted;
    }

    /** Used by playlist events. Give the prefab/node a unique name in Cocos. */
    public get cardId(): string {
        return this.node.name;
    }

    private _controller: MuzioPlaylistController | null = null;
    private _originParent: Node | null = null;
    private _originSiblingIndex = 0;
    private readonly _originPosition = new Vec3();
    private readonly _originScale = new Vec3(1, 1, 1);
    private readonly _worldRect = new Rect();
    private _accepted = false;
    private _originCaptured = false;
    private _activeTween: Tween<Node> | null = null;
    private _pendingTweenResolver: (() => void) | null = null;

    protected onLoad(): void {
        this.ensureInitialized();
    }

    /** Safe to call before this component's onLoad when a manager initializes first. */
    public ensureInitialized(): void {
        this.draggable = this.draggable ?? this.getComponent(DraggableNode2D);
        if (!this.draggable) {
            this.draggable = this.addComponent(DraggableNode2D);
        }

        if (!this._originCaptured) {
            this.captureOrigin();
        }

        this.setDragEnabled(false);
    }

    protected onEnable(): void {
        this.node.on(DraggableNode2DEvent.DRAG_START, this._onDragStart, this);
        this.node.on(DraggableNode2DEvent.DRAG_END, this._onDragEnd, this);
    }

    protected onDisable(): void {
        this.node.off(DraggableNode2DEvent.DRAG_START, this._onDragStart, this);
        this.node.off(DraggableNode2DEvent.DRAG_END, this._onDragEnd, this);
        this._stopTween();
    }

    public setController(controller: MuzioPlaylistController | null): void {
        this._controller = controller;
    }

    public captureOrigin(): void {
        this._originParent = this.node.parent;
        this._originSiblingIndex = this.node.getSiblingIndex();
        this._originPosition.set(this.node.position);
        this._originScale.set(this.node.scale);
        this._originCaptured = true;
    }

    public setDragEnabled(enabled: boolean): void {
        this.draggable?.setDragEnabled(enabled && !this._accepted);
    }

    public getWorldRect(out?: Rect): Rect {
        const ui = this.node.getComponent(UITransform);
        if (!ui) {
            const empty = out ?? this._worldRect;
            empty.set(this.node.worldPosition.x, this.node.worldPosition.y, 0, 0);
            return empty;
        }

        const bounds = ui.getBoundingBoxToWorld();
        const target = out ?? this._worldRect;
        target.set(bounds);
        return target;
    }

    public async snapInto(slot: Node): Promise<void> {
        this._accepted = true;
        this.setDragEnabled(false);
        this._stopTween();

        this.node.setParent(slot, true);
        await this._animateLocal(
            Vec3.ZERO,
            this._originScale,
            this.snapDuration,
            'backOut',
        );
    }

    public async moveToEndSlot(slot: Node): Promise<void> {
        this._stopTween();
        this.node.setParent(slot, true);
        if (!this.node.activeInHierarchy) {
            this.node.setPosition(Vec3.ZERO);
            this.node.setScale(this._originScale);
            return;
        }

        await this._animateLocal(
            Vec3.ZERO,
            this._originScale,
            this.snapDuration,
            'sineOut',
        );
    }

    public async returnToSource(): Promise<void> {
        this._accepted = false;
        this._stopTween();

        if (!this._originParent?.isValid) {
            return;
        }

        this.node.setParent(this._originParent, true);
        this.node.setSiblingIndex(
            Math.min(this._originSiblingIndex, this._originParent.children.length - 1),
        );

        await this._animateLocal(
            this._originPosition,
            this._originScale,
            this.returnDuration,
            'sineOut',
        );
    }

    public resetCard(): void {
        this.ensureInitialized();
        this._accepted = false;
        this._stopTween();

        if (this._originParent?.isValid) {
            this.node.setParent(this._originParent, false);
            this.node.setSiblingIndex(
                Math.min(this._originSiblingIndex, this._originParent.children.length - 1),
            );
        }

        this.node.setPosition(this._originPosition);
        this.node.setScale(this._originScale);
        this.setDragEnabled(false);
    }

    private _onDragStart(): void {
        if (this._accepted) {
            return;
        }

        this._stopTween();
        const targetScale = new Vec3(
            this._originScale.x * this.dragScale,
            this._originScale.y * this.dragScale,
            this._originScale.z,
        );

        this._activeTween = tween(this.node)
            .to(0.1, { scale: targetScale }, { easing: 'sineOut' })
            .call(() => { this._activeTween = null; })
            .start();

        this._controller?.onCardDragStarted(this);
    }

    private _onDragEnd(): void {
        if (this._accepted) {
            return;
        }
        void this._controller?.handleCardDropped(this);
    }

    private _animateLocal(
        position: Readonly<Vec3>,
        scale: Readonly<Vec3>,
        duration: number,
        easing: string,
    ): Promise<void> {
        const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
        const targetPosition = new Vec3(position.x, position.y, position.z);
        const targetScale = new Vec3(scale.x, scale.y, scale.z);

        if (safeDuration <= 0) {
            this.node.setPosition(targetPosition);
            this.node.setScale(targetScale);
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this._pendingTweenResolver = resolve;
            this._activeTween = tween(this.node)
                .to(
                    safeDuration,
                    { position: targetPosition, scale: targetScale },
                    { easing },
                )
                .call(() => {
                    this._activeTween = null;
                    this._pendingTweenResolver = null;
                    resolve();
                })
                .start();
        });
    }

    private _stopTween(): void {
        if (!this._activeTween) {
            return;
        }

        this._activeTween.stop();
        this._activeTween = null;

        if (this._pendingTweenResolver) {
            const resolve = this._pendingTweenResolver;
            this._pendingTweenResolver = null;
            resolve();
        }
    }

    private _log(...args: unknown[]): void {
        if (this.debugLogs) {
            console.log('[PlaylistSongCard]', ...args);
        }
    }
}
