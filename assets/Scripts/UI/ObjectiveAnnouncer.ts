import {
    _decorator,
    CCString,
    Component,
    Label,
    Node,
    RichText,
} from 'cc';
import { NodePopInOut } from '../Animation/NodePopInOut';

const { ccclass, property } = _decorator;

@ccclass('ObjectiveAnnouncer')
export class ObjectiveAnnouncer extends Component {
    @property({
        type: Node,
        tooltip: 'Animated container. Defaults to this node.',
    })
    public rootNode: Node | null = null;

    @property({
        type: NodePopInOut,
        tooltip: 'Pop animation on rootNode for quest start and correct-scan dismiss.',
    })
    public popInOut: NodePopInOut | null = null;

    @property({
        type: Label,
        tooltip: 'Static prefix label, e.g. Find and Scan.',
    })
    public prefixLabel: Label | null = null;

    @property({
        type: Label,
        tooltip: 'Dynamic objective name label.',
    })
    public objectiveLabel: Label | null = null;

    @property({
        type: RichText,
        tooltip: 'Optional RichText alternative to objectiveLabel.',
    })
    public objectiveRichText: RichText | null = null;

    @property({
        type: CCString,
        tooltip: 'Template for the objective line. Use {name} for the target label text.',
    })
    public nameTemplate = 'The "{name}"!';

    @property({
        tooltip: 'Automatically pop in after setObjectiveName when startRandomQuest runs.',
    })
    public popInOnSetObjective = true;

    @property
    public debugLogs = false;

    protected onLoad(): void {
        if (!this.rootNode) {
            this.rootNode = this.node;
        }

        if (!this.popInOut && this.rootNode) {
            this.popInOut = this.rootNode.getComponent(NodePopInOut)
                ?? this.rootNode.getComponentInChildren(NodePopInOut);
        }
    }

    public setObjectiveName(name: string): void {
        const formatted = this.nameTemplate.replace(/\{name\}/g, name);
        this._setObjectiveText(formatted);
        this._log('objective set:', formatted);
    }

    public async popIn(): Promise<void> {
        if (!this.popInOut) {
            this.show();
            return;
        }

        const result = this.popInOut.popIn(true);
        if (result instanceof Promise) {
            await result;
        }
    }

    public async popOut(): Promise<void> {
        if (!this.popInOut) {
            this.hide();
            return;
        }

        const result = this.popInOut.popOut(true);
        if (result instanceof Promise) {
            await result;
        }
    }

    public show(): void {
        const root = this.rootNode ?? this.node;
        if (root) {
            root.active = true;
        }
    }

    public hide(): void {
        const root = this.rootNode ?? this.node;
        if (root) {
            root.active = false;
        }
    }

    private _setObjectiveText(text: string): void {
        if (this.objectiveRichText) {
            this.objectiveRichText.string = text;
            return;
        }

        if (this.objectiveLabel) {
            this.objectiveLabel.string = text;
        }
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[ObjectiveAnnouncer]', ...args);
    }
}
