import {
    _decorator,
    CCString,
    Color,
    Component,
    instantiate,
    Label,
    Node,
    Prefab,
    RichText,
    UITransform,
} from 'cc';
import { NodePopInOut } from '../Animation/NodePopInOut';
import { ScannableTarget } from '../Detection/ScannableTarget';
import { ViewportOverlapDetector } from '../Detection/ViewportOverlapDetector';
import { ObjectiveAnnouncer } from '../UI/ObjectiveAnnouncer';
import {
    PlayableEvent,
    PlayableEvents,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

@ccclass('ScanQuestController')
export class ScanQuestController extends Component {
    @property({
        type: [ScannableTarget],
        tooltip: 'All quest targets. Auto-collects from scene when empty.',
    })
    public targets: ScannableTarget[] = [];

    @property({
        type: ViewportOverlapDetector,
        tooltip: 'Phone viewport detector used for scanning.',
    })
    public viewportDetector: ViewportOverlapDetector | null = null;

    @property({
        type: ObjectiveAnnouncer,
        tooltip: 'Top HUD announcer for the current objective.',
    })
    public objectiveAnnouncer: ObjectiveAnnouncer | null = null;

    @property({
        type: Node,
        tooltip: 'Success toast node with NodePopInOut.',
    })
    public successToast: Node | null = null;

    @property({
        type: Prefab,
        tooltip: 'Prefab spawned when a wrong target is scanned.',
    })
    public wrongLabelPrefab: Prefab | null = null;

    @property({
        type: Node,
        tooltip: 'Parent for spawned wrong-scan labels.',
    })
    public wrongLabelParent: Node | null = null;

    @property({
        type: CCString,
        tooltip: 'Optional child name for Label inside wrong label prefab.',
    })
    public wrongLabelNodeName = 'Label';

    @property({
        tooltip: 'Text shown on the success toast.',
    })
    public successMessage = 'Correct!';

    @property({
        min: 0,
        tooltip: 'Hold delay passed to success toast popInThenOut.',
    })
    public successHoldDelay = 0.8;

    @property({
        tooltip: 'Sprite tint applied to wrong targets.',
    })
    public dimColor = new Color(120, 120, 120, 255);

    @property
    public debugLogs = false;

    private _resolvedTargets: ScannableTarget[] = [];
    private _objectiveTarget: ScannableTarget | null = null;
    private _questComplete = false;
    private _isHandlingScan = false;

    protected onLoad(): void {
        this._resolveTargetList();
    }

    public startRandomQuest(): void {
        this._questComplete = false;
        this._isHandlingScan = false;
        this._resolveTargetList();

        const candidates = this._resolvedTargets.filter(
            (target) => target && target.isValid && !target.isComplete && !target.isExcluded,
        );

        if (candidates.length <= 0) {
            this._log('no candidates for random quest');
            return;
        }

        const index = Math.floor(Math.random() * candidates.length);
        this._objectiveTarget = candidates[index];

        if (this.objectiveAnnouncer) {
            this.objectiveAnnouncer.setObjectiveName(this._objectiveTarget.labelText);

            if (this.objectiveAnnouncer.popInOnSetObjective) {
                void this.objectiveAnnouncer.popIn();
            }
        }

        if (this.viewportDetector) {
            this.viewportDetector.setDetectionEnabled(true);
        }

        this._log('quest started, objective:', this._objectiveTarget.id);
    }

    public resetQuest(): void {
        this._questComplete = false;
        this._isHandlingScan = false;
        this._objectiveTarget = null;

        for (let i = 0; i < this._resolvedTargets.length; i += 1) {
            const target = this._resolvedTargets[i];
            if (target?.isValid) {
                target.reset();
            }
        }

        if (this.viewportDetector) {
            this.viewportDetector.setDetectionEnabled(true);
            this.viewportDetector.refreshTargets();
        }

        this._log('quest reset');
    }

    public async onScanFinished(target: ScannableTarget): Promise<void> {
        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScanQuestController.ts:onScanFinished',message:'scan finished entry',data:{targetId:target?.id,objectiveId:this._objectiveTarget?.id,isMatch:target===this._objectiveTarget,questComplete:this._questComplete,isHandling:this._isHandlingScan},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (this._questComplete || this._isHandlingScan) {
            return;
        }

        if (!target || target.isExcluded) {
            return;
        }

        this._isHandlingScan = true;

        try {
            if (target !== this._objectiveTarget) {
                await this._handleWrongScan(target);
                return;
            }

            await this._handleCorrectScan(target);
        } finally {
            this._isHandlingScan = false;
        }
    }

    private async _handleWrongScan(target: ScannableTarget): Promise<void> {
        this._spawnWrongLabel(target);
        target.markWrong(this.dimColor);
        this._log('wrong scan:', target.id);
    }

    private async _handleCorrectScan(target: ScannableTarget): Promise<void> {
        if (this.viewportDetector) {
            this.viewportDetector.setDetectionEnabled(false);
        }

        if (this.objectiveAnnouncer) {
            await this.objectiveAnnouncer.popOut();
        }

        await this._playSuccessToast();

        target.markComplete();
        this._questComplete = true;
        PlayableEvents.emit(PlayableEvent.QUEST_COMPLETE);
        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScanQuestController.ts:_handleCorrectScan',message:'QUEST_COMPLETE emitted',data:{targetId:target.id},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        this._log('correct scan:', target.id);
    }

    private async _playSuccessToast(): Promise<void> {
        if (!this.successToast) {
            return;
        }

        this.successToast.active = true;
        this._setSuccessToastText(this.successMessage);

        const popInOut = this.successToast.getComponent(NodePopInOut)
            ?? this.successToast.getComponentInChildren(NodePopInOut);

        if (!popInOut) {
            return;
        }

        const result = popInOut.popInThenOut(true, undefined, this.successHoldDelay);
        if (result instanceof Promise) {
            await result;
        }
    }

    private _spawnWrongLabel(target: ScannableTarget): void {
        if (!this.wrongLabelPrefab || !this.wrongLabelParent) {
            return;
        }

        const labelNode = instantiate(this.wrongLabelPrefab);
        labelNode.setParent(this.wrongLabelParent);
        labelNode.active = true;

        this._setLabelText(labelNode, target.labelText);
        this._positionLabel(labelNode, target);

        const popIn = labelNode.getComponent(NodePopInOut)
            ?? labelNode.getComponentInChildren(NodePopInOut);

        if (popIn) {
            void popIn.popIn(true);
        }
    }

    private _setSuccessToastText(text: string): void {
        if (!this.successToast) {
            return;
        }

        const richText = this.successToast.getComponent(RichText)
            ?? this.successToast.getComponentInChildren(RichText);
        if (richText) {
            richText.string = text;
            return;
        }

        const label = this.successToast.getComponent(Label)
            ?? this.successToast.getComponentInChildren(Label);
        if (label) {
            label.string = text;
        }
    }

    private _setLabelText(labelNode: Node, text: string): void {
        const label = this._findLabel(labelNode);
        if (label) {
            label.string = text;
        }
    }

    private _findLabel(root: Node): Label | null {
        if (this.wrongLabelNodeName) {
            const namedChild = root.getChildByName(this.wrongLabelNodeName);
            const namedLabel = namedChild?.getComponent(Label);
            if (namedLabel) {
                return namedLabel;
            }
        }

        return root.getComponent(Label) ?? root.getComponentInChildren(Label);
    }

    private _positionLabel(labelNode: Node, target: ScannableTarget): void {
        const parent = this.wrongLabelParent ?? this.node;
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

    private _resolveTargetList(): void {
        if (this.targets.length > 0) {
            this._resolvedTargets = this.targets.filter(
                (target) => target && target.isValid,
            );
            return;
        }

        const scene = this.node.scene;
        this._resolvedTargets = scene
            ? scene.getComponentsInChildren(ScannableTarget)
            : [];
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[ScanQuestController]', ...args);
    }
}
