import {
    _decorator,
    CCString,
    Component,
    Enum,
    Layout,
    Node,
    tween,
    Tween,
    UITransform,
    Vec3,
} from 'cc';
import { NodeFadeAnimator } from '../Animation/NodeFadeAnimator';
import { DraggableNode2D, DraggableNode2DEvent } from './DraggableNode2D';

const { ccclass, property } = _decorator;

enum SortOrientation {
    Vertical = 0,
    Horizontal = 1,
}

enum SortItemSource {
    ReferencedItems = 0,
    ParentChildren = 1,
}

enum SortParentMode {
    Self = 0,
    SelectedParent = 1,
}

enum DragHighlightMode {
    SharedReference = 0,
    FollowDraggedItem = 1,
    DraggedItemChildByName = 2,
}

Enum(SortOrientation);
Enum(SortItemSource);
Enum(SortParentMode);
Enum(DragHighlightMode);

type DragEventHandlers = {
    onStart: () => void;
    onMove: () => void;
    onEnd: () => void;
};

@ccclass('SortableDraggableList')
export class SortableDraggableList extends Component {
    @property({
        type: Enum(SortOrientation),
        tooltip: 'Sort items along this axis.',
    })
    public orientation: SortOrientation = SortOrientation.Vertical;

    @property({
        type: Enum(SortItemSource),
        tooltip: 'Use explicit item references or all children from the resolved parent.',
    })
    public itemSource: SortItemSource = SortItemSource.ReferencedItems;

    @property({
        type: [Node],
        tooltip: 'Items to sort when Item Source is Referenced Items.',
    })
    public items: Node[] = [];

    @property({
        type: Enum(SortParentMode),
        tooltip: 'Where sorted items are parented and re-ordered.',
    })
    public parentMode: SortParentMode = SortParentMode.Self;

    @property({
        type: Node,
        tooltip: 'Used when Parent Mode is Selected Parent.',
    })
    public listParent: Node | null = null;

    @property({
        tooltip: 'Move referenced items under the resolved parent when needed.',
    })
    public adoptItemsToParent = true;

    @property({
        tooltip: 'Automatically add DraggableNode2D to items that do not have one.',
    })
    public autoAddDraggable = true;

    @property({
        tooltip: 'Snap dragged item to its slot on drop when no Layout drives positions.',
    })
    public snapOnDrop = true;

    @property({
        tooltip: 'Gap added between item slots on the active axis.',
    })
    public spacing = 0;

    @property({
        tooltip: 'When true, uses current item positions as slot positions. Disable to generate slots from spacing.',
    })
    public useCurrentPositionsAsSlots = true;

    @property({
        type: Vec3,
        tooltip: 'Offset applied to the first generated slot when current positions are not used.',
    })
    public slotStartOffset = new Vec3();

    @property({
        min: 0,
        tooltip: 'Duration in seconds for non-dragged items reflowing while dragging.',
    })
    public reflowDuration = 0.14;

    @property({
        type: CCString,
        tooltip: 'Tween easing for reflow while dragging.',
    })
    public reflowEasing = 'sineOut';

    @property({
        min: 0,
        tooltip: 'Duration in seconds for dragged item snapping to its final slot on drop.',
    })
    public dropSnapDuration = 0.16;

    @property({
        type: CCString,
        tooltip: 'Tween easing for dragged item drop snap.',
    })
    public dropSnapEasing = 'sineOut';

    @property({
        type: NodeFadeAnimator,
        tooltip: 'Optional shared highlight fade animator used by Shared Reference and Follow Dragged Item modes.',
    })
    public dragHighlightFade: NodeFadeAnimator | null = null;

    @property({
        type: Enum(DragHighlightMode),
        tooltip: 'How drag highlight is resolved: shared reference, follow dragged item, or dragged item child by name.',
    })
    public dragHighlightMode: DragHighlightMode = DragHighlightMode.SharedReference;

    @property({
        tooltip: 'Child node name searched under the dragged item when Highlight Mode is Dragged Item Child By Name.',
    })
    public highlightChildNodeName = 'Highlight';

    @property({
        min: 0,
        max: 1,
        tooltip: 'Highlight opacity target while drag is active.',
    })
    public highlightFadeInOpacity = 1;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Highlight opacity target after drag ends.',
    })
    public highlightFadeOutOpacity = 0;

    @property({
        min: 0,
        tooltip: 'Highlight fade-in duration in seconds.',
    })
    public highlightFadeInDuration = 0.12;

    @property({
        min: 0,
        tooltip: 'Highlight fade-out duration in seconds.',
    })
    public highlightFadeOutDuration = 0.16;

    @property({
        type: CCString,
        tooltip: 'Tween easing used for highlight fades.',
    })
    public highlightFadeEasing = 'sineOut';

    @property({
        tooltip: 'Resolve, normalize, and sort once when this component enables.',
    })
    public sortOnEnable = true;

    @property
    public debugLogs = false;

    private readonly _listenersByNode = new Map<Node, DragEventHandlers>();
    private readonly _slotPositions: Vec3[] = [];
    private readonly _activeTweensByNode = new Map<Node, Tween<Node>>();
    private _resolvedParent: Node | null = null;
    private _resolvedItems: Node[] = [];
    private _activeDraggedNode: Node | null = null;
    private _activeHighlightAnimator: NodeFadeAnimator | null = null;
    private _lastInsertIndex = -1;
    private _layout: Layout | null = null;

    protected onEnable(): void {
        this.refreshList();
        if (this.sortOnEnable) {
            this.sortNow();
        }
    }

    protected start(): void {
        // Run one more pass after initial layout/content sizing has settled.
        if (!this.sortOnEnable) {
            return;
        }

        this.scheduleOnce(() => {
            if (!this.isValid || !this.enabledInHierarchy) {
                return;
            }
            this.sortNow();
        }, 0);
    }

    protected onDisable(): void {
        this._unbindAll();
        this._stopAllTweens();
        this._fadeHighlightOut(this._activeDraggedNode);
        this._activeDraggedNode = null;
        this._activeHighlightAnimator = null;
        this._lastInsertIndex = -1;
    }

    public refreshList(): void {
        const parent = this._resolveParent();
        this._resolvedParent = parent;
        this._layout = parent?.getComponent(Layout) ?? null;

        if (!parent) {
            this._resolvedItems = [];
            this._unbindAll();
            this._log('missing parent');
            return;
        }

        const nextItems = this._collectItems(parent);
        this._resolvedItems = nextItems;
        this._bindResolvedItems();
        this._captureSlotPositions();
    }

    public sortNow(): void {
        const parent = this._resolvedParent ?? this._resolveParent();
        if (!parent) {
            return;
        }

        this._resolvedItems = this._resolvedItems.filter(
            (item) => item && item.isValid && item.parent === parent,
        );
        this._applySiblingOrder();
        this._captureSlotPositions();
        this._applySlotsImmediately();
        if (this._layout && !this._shouldUseManualReflow()) {
            this._layout.updateLayout();
        }
    }

    private _resolveParent(): Node | null {
        if (this.parentMode === SortParentMode.SelectedParent) {
            return this.listParent ?? null;
        }
        return this.node;
    }

    private _collectItems(parent: Node): Node[] {
        const source = this.itemSource === SortItemSource.ParentChildren
            ? parent.children.slice()
            : this.items.slice();

        const unique = new Set<Node>();
        const resolved: Node[] = [];
        for (let i = 0; i < source.length; i += 1) {
            const item = source[i];
            if (!item || !item.isValid || unique.has(item)) {
                continue;
            }

            if (!this._prepareItemParent(item, parent)) {
                continue;
            }

            const draggable = this._ensureDraggable(item);
            if (!draggable) {
                continue;
            }

            unique.add(item);
            resolved.push(item);
        }

        resolved.sort((a, b) => a.getSiblingIndex() - b.getSiblingIndex());
        return resolved;
    }

    private _prepareItemParent(item: Node, parent: Node): boolean {
        if (item.parent === parent) {
            return true;
        }

        if (!this.adoptItemsToParent) {
            this._log('skip item outside parent', item.name);
            return false;
        }

        item.setParent(parent, true);
        return true;
    }

    private _ensureDraggable(item: Node): DraggableNode2D | null {
        const existing = item.getComponent(DraggableNode2D);
        if (existing) {
            return existing;
        }

        if (!this.autoAddDraggable) {
            this._log('missing DraggableNode2D', item.name);
            return null;
        }

        return item.addComponent(DraggableNode2D);
    }

    private _bindResolvedItems(): void {
        this._unbindAll();

        for (let i = 0; i < this._resolvedItems.length; i += 1) {
            const item = this._resolvedItems[i];
            const handlers: DragEventHandlers = {
                onStart: () => this._onItemDragStart(item),
                onMove: () => this._onItemDragMove(item),
                onEnd: () => this._onItemDragEnd(item),
            };

            item.on(DraggableNode2DEvent.DRAG_START, handlers.onStart, this);
            item.on(DraggableNode2DEvent.DRAG_MOVE, handlers.onMove, this);
            item.on(DraggableNode2DEvent.DRAG_END, handlers.onEnd, this);
            this._listenersByNode.set(item, handlers);
        }
    }

    private _unbindAll(): void {
        this._listenersByNode.forEach((handlers, item) => {
            if (!item || !item.isValid) {
                return;
            }
            item.off(DraggableNode2DEvent.DRAG_START, handlers.onStart, this);
            item.off(DraggableNode2DEvent.DRAG_MOVE, handlers.onMove, this);
            item.off(DraggableNode2DEvent.DRAG_END, handlers.onEnd, this);
        });
        this._listenersByNode.clear();
    }

    private _captureSlotPositions(): void {
        this._slotPositions.length = 0;

        if (!this.useCurrentPositionsAsSlots) {
            this._buildGeneratedSlots();
            return;
        }

        for (let i = 0; i < this._resolvedItems.length; i += 1) {
            this._slotPositions.push(this._resolvedItems[i].position.clone());
        }
    }

    private _buildGeneratedSlots(): void {
        if (this._resolvedItems.length <= 0) {
            return;
        }

        const firstPosition = this._resolvedItems[0].position.clone();
        firstPosition.add(this.slotStartOffset);
        this._slotPositions.push(firstPosition);

        const direction = this.orientation === SortOrientation.Horizontal
            ? new Vec3(1, 0, 0)
            : new Vec3(0, -1, 0);

        for (let i = 1; i < this._resolvedItems.length; i += 1) {
            const previous = this._slotPositions[i - 1];
            const prevSize = this._getNodeAxisSize(this._resolvedItems[i - 1]);
            const nextSize = this._getNodeAxisSize(this._resolvedItems[i]);
            const distance = ((prevSize + nextSize) * 0.5) + this.spacing;

            const next = previous.clone();
            next.x += direction.x * distance;
            next.y += direction.y * distance;
            this._slotPositions.push(next);
        }
    }

    private _getNodeAxisSize(node: Node): number {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return 0;
        }
        return this.orientation === SortOrientation.Horizontal
            ? transform.width
            : transform.height;
    }

    private _onItemDragStart(item: Node): void {
        if (this._activeDraggedNode && this._activeDraggedNode !== item) {
            return;
        }

        if (!this._resolvedParent || item.parent !== this._resolvedParent) {
            this.refreshList();
        }

        const index = this._resolvedItems.indexOf(item);
        if (index < 0 || !this._resolvedParent) {
            return;
        }

        this._activeDraggedNode = item;
        this._lastInsertIndex = index;
        this._captureSlotPositions();

        this._stopNodeTween(item);
        this._activeHighlightAnimator = this._resolveHighlightAnimator(item);
        this._fadeHighlightIn(item);
        item.setSiblingIndex(this._resolvedParent.children.length - 1);
        this._log('drag-start', item.name, index);
    }

    private _onItemDragMove(item: Node): void {
        if (this._activeDraggedNode !== item || !this._resolvedParent) {
            return;
        }

        const targetIndex = this._computeInsertionIndex(item);
        if (targetIndex < 0 || targetIndex === this._lastInsertIndex) {
            return;
        }

        this._moveItemInOrder(item, targetIndex);
        this._lastInsertIndex = targetIndex;
        this._applyVisualOrderDuringDrag();
        this._updateFollowHighlight(item);
        this._log('drag-move', item.name, targetIndex);
    }

    private _onItemDragEnd(item: Node): void {
        if (this._activeDraggedNode !== item || !this._resolvedParent) {
            return;
        }

        if (this.snapOnDrop) {
            const index = this._resolvedItems.indexOf(item);
            if (index >= 0 && index < this._slotPositions.length) {
                this._animateNodeToPosition(
                    item,
                    this._slotPositions[index],
                    this.dropSnapDuration,
                    this.dropSnapEasing,
                );
            }
        }

        this._applySiblingOrder();
        if (this._layout && !this._shouldUseManualReflow()) {
            this._layout.updateLayout();
        }
        this._captureSlotPositions();
        this._fadeHighlightOut(item);

        this._activeDraggedNode = null;
        this._activeHighlightAnimator = null;
        this._lastInsertIndex = -1;
        this._log('drag-end', item.name);
    }

    private _computeInsertionIndex(item: Node): number {
        if (this._slotPositions.length <= 0) {
            return -1;
        }

        const draggedAxis = this._axisValue(item.position);
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < this._slotPositions.length; i += 1) {
            const distance = Math.abs(draggedAxis - this._axisValue(this._slotPositions[i]));
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    private _axisValue(position: Vec3): number {
        if (this.orientation === SortOrientation.Horizontal) {
            return position.x;
        }
        return position.y;
    }

    private _moveItemInOrder(item: Node, targetIndex: number): void {
        const currentIndex = this._resolvedItems.indexOf(item);
        if (currentIndex < 0 || currentIndex === targetIndex) {
            return;
        }

        this._resolvedItems.splice(currentIndex, 1);
        this._resolvedItems.splice(targetIndex, 0, item);
    }

    private _applyVisualOrderDuringDrag(): void {
        if (!this._resolvedParent) {
            return;
        }

        for (let i = 0; i < this._resolvedItems.length; i += 1) {
            const node = this._resolvedItems[i];
            if (node === this._activeDraggedNode || node.parent !== this._resolvedParent) {
                continue;
            }

            node.setSiblingIndex(i);
            if (i < this._slotPositions.length) {
                this._animateNodeToPosition(
                    node,
                    this._slotPositions[i],
                    this.reflowDuration,
                    this.reflowEasing,
                );
            }
        }

        if (this._activeDraggedNode) {
            this._activeDraggedNode.setSiblingIndex(this._resolvedParent.children.length - 1);
        }

        if (this._layout && !this._shouldUseManualReflow()) {
            this._layout.updateLayout();
        }
    }

    private _applySlotsImmediately(): void {
        for (let i = 0; i < this._resolvedItems.length; i += 1) {
            const node = this._resolvedItems[i];
            if (!node || !node.isValid || i >= this._slotPositions.length) {
                continue;
            }

            this._stopNodeTween(node);
            node.setPosition(this._slotPositions[i]);
        }
    }

    private _animateNodeToPosition(
        node: Node,
        targetPosition: Vec3,
        duration: number,
        easing: string,
    ): void {
        this._stopNodeTween(node);

        const safeDuration = this._sanitizeDuration(duration);
        if (safeDuration <= 0) {
            node.setPosition(targetPosition);
            return;
        }

        const safeEasing = this._sanitizeEasing(easing, 'sineOut');
        const animation = tween(node)
            .to(safeDuration, { position: targetPosition }, { easing: safeEasing })
            .call(() => {
                this._activeTweensByNode.delete(node);
            })
            .start();

        this._activeTweensByNode.set(node, animation);
    }

    private _stopNodeTween(node: Node): void {
        const active = this._activeTweensByNode.get(node);
        if (!active) {
            return;
        }
        active.stop();
        this._activeTweensByNode.delete(node);
    }

    private _stopAllTweens(): void {
        this._activeTweensByNode.forEach((active, node) => {
            if (node && node.isValid) {
                active.stop();
            }
        });
        this._activeTweensByNode.clear();
    }

    private _fadeHighlightIn(draggedItem: Node | null): void {
        const highlight = this._resolveHighlightAnimator(draggedItem);
        if (!highlight) {
            return;
        }

        this._updateFollowHighlight(draggedItem);
        highlight.fadeToNoWait(
            this.highlightFadeInOpacity,
            this.highlightFadeInDuration,
            this.highlightFadeEasing,
        );
    }

    private _fadeHighlightOut(draggedItem: Node | null): void {
        const highlight = this._resolveHighlightAnimator(draggedItem);
        if (!highlight) {
            return;
        }

        highlight.fadeToNoWait(
            this.highlightFadeOutOpacity,
            this.highlightFadeOutDuration,
            this.highlightFadeEasing,
        );
    }

    private _resolveHighlightAnimator(draggedItem: Node | null): NodeFadeAnimator | null {
        if (this.dragHighlightMode === DragHighlightMode.SharedReference
            || this.dragHighlightMode === DragHighlightMode.FollowDraggedItem
        ) {
            return this.dragHighlightFade;
        }

        if (!draggedItem) {
            return this._activeHighlightAnimator;
        }

        const targetName = this.highlightChildNodeName.trim();
        if (!targetName) {
            return null;
        }

        const child = this._findChildByNameRecursive(draggedItem, targetName);
        if (!child) {
            return null;
        }

        const childAnimator = child.getComponent(NodeFadeAnimator);
        if (childAnimator) {
            return childAnimator;
        }

        // Fallback: reuse the shared animator as a retargetable controller.
        if (this.dragHighlightFade) {
            this.dragHighlightFade.targetNode = child;
            return this.dragHighlightFade;
        }

        return null;
    }

    private _updateFollowHighlight(draggedItem: Node | null): void {
        if (
            this.dragHighlightMode !== DragHighlightMode.FollowDraggedItem
            || !draggedItem
            || !this.dragHighlightFade?.node
        ) {
            return;
        }

        this.dragHighlightFade.node.setWorldPosition(draggedItem.worldPosition);
    }

    private _findChildByNameRecursive(root: Node, targetName: string): Node | null {
        if (root.name === targetName) {
            return root;
        }

        for (let i = 0; i < root.children.length; i += 1) {
            const found = this._findChildByNameRecursive(root.children[i], targetName);
            if (found) {
                return found;
            }
        }

        return null;
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, value);
    }

    private _sanitizeEasing(value: string, fallback: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : fallback;
    }

    private _shouldUseManualReflow(): boolean {
        return this.spacing !== 0
            || !this.useCurrentPositionsAsSlots
            || this.reflowDuration > 0
            || this.dropSnapDuration > 0;
    }

    private _applySiblingOrder(): void {
        if (!this._resolvedParent) {
            return;
        }

        for (let i = 0; i < this._resolvedItems.length; i += 1) {
            const item = this._resolvedItems[i];
            if (item.parent !== this._resolvedParent) {
                continue;
            }
            item.setSiblingIndex(i);
        }
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[SortableDraggableList]', ...args);
    }
}
