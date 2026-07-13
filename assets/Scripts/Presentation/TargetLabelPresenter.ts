import {
    _decorator,
    CCString,
    Component,
    instantiate,
    Label,
    Node,
    Prefab,
    UITransform,
    Vec3,
} from 'cc';
import { ScannableTarget } from '../Detection/ScannableTarget';
import { NodePopInOut } from '../Animation/NodePopInOut';
import {
    PlayableEvent,
    PlayableEvents,
    type TargetScanStartedPayload,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

@ccclass('TargetLabelPresenter')
export class TargetLabelPresenter extends Component {
    @property({
        type: Prefab,
        tooltip: 'Prefab used for spawned labels. Should include a Label and optional NodePopInOut.',
    })
    public labelPrefab: Prefab | null = null;

    @property({
        type: Node,
        tooltip: 'Parent node for spawned labels.',
    })
    public labelParent: Node | null = null;

    @property({
        type: CCString,
        tooltip: 'Optional child path or property name for the Label component inside the prefab.',
    })
    public labelNodeName = 'Label';

    @property({
        min: 0,
        tooltip: 'Optional pool size for label reuse. 0 disables pooling.',
    })
    public labelPoolSize = 0;

    @property
    public debugLogs = false;

    private readonly _labelPool: Node[] = [];
    private _boundHandler: ((payload: TargetScanStartedPayload) => void) | null = null;

    protected onEnable(): void {
        this._boundHandler = (payload: TargetScanStartedPayload) => {
            void this._onTargetScanStarted(payload);
        };
        PlayableEvents.on(PlayableEvent.TARGET_SCAN_STARTED, this._boundHandler, this);
    }

    protected onDisable(): void {
        if (this._boundHandler) {
            PlayableEvents.off(PlayableEvent.TARGET_SCAN_STARTED, this._boundHandler, this);
            this._boundHandler = null;
        }
    }

    private async _onTargetScanStarted(
        payload: TargetScanStartedPayload,
    ): Promise<void> {
        const target = payload?.target;
        if (!target || !this.labelPrefab || !this.labelParent) {
            this._log('missing target, prefab, or parent');
            return;
        }

        const labelNode = this._acquireLabelNode();
        if (!labelNode) {
            return;
        }

        this._setLabelText(labelNode, target.labelText);
        this._positionLabel(labelNode, target);

        const popIn = labelNode.getComponent(NodePopInOut)
            ?? labelNode.getComponentInChildren(NodePopInOut);

        if (popIn) {
            await popIn.popIn(true);
        }

        target.markComplete();
        this._log('label shown for', target.id);
    }

    private _acquireLabelNode(): Node | null {
        if (!this.labelPrefab || !this.labelParent) {
            return null;
        }

        if (this.labelPoolSize > 0) {
            const pooled = this._labelPool.pop();
            if (pooled && pooled.isValid) {
                pooled.active = true;
                pooled.setParent(this.labelParent);
                return pooled;
            }
        }

        const instance = instantiate(this.labelPrefab);
        instance.setParent(this.labelParent);
        return instance;
    }

    private _setLabelText(labelNode: Node, text: string): void {
        const labelComponent = this._findLabel(labelNode);
        if (labelComponent) {
            labelComponent.string = text;
        }
    }

    private _findLabel(root: Node): Label | null {
        if (this.labelNodeName) {
            const namedChild = root.getChildByName(this.labelNodeName);
            const namedLabel = namedChild?.getComponent(Label);
            if (namedLabel) {
                return namedLabel;
            }
        }

        return root.getComponent(Label) ?? root.getComponentInChildren(Label);
    }

    private _positionLabel(labelNode: Node, target: ScannableTarget): void {
        const parent = this.labelParent ?? this.node;
        labelNode.setParent(parent);

        const parentTransform = parent.getComponent(UITransform);
        const worldPosition = target.getLabelWorldPosition();

        if (parentTransform) {
            const localPosition = parentTransform.convertToNodeSpaceAR(worldPosition);
            labelNode.setPosition(localPosition);
            return;
        }

        labelNode.setWorldPosition(worldPosition);
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[TargetLabelPresenter]', ...args);
    }
}
