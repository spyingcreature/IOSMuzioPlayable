import {
    _decorator,
    Component,
    Node,
    ProgressBar,
    Sprite,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('TargetScanProgressBar')
export class TargetScanProgressBar extends Component {
    @property({
        type: Node,
        tooltip: 'Node toggled on show/hide. Defaults to this component node.',
    })
    public rootNode: Node | null = null;

    @property({
        type: Sprite,
        tooltip: 'Filled sprite (RADIAL for circular, HORIZONTAL/VERTICAL for linear).',
    })
    public fillSprite: Sprite | null = null;

    @property({
        type: ProgressBar,
        tooltip: 'Optional built-in ProgressBar instead of fillSprite.',
    })
    public progressBar: ProgressBar | null = null;

    private _root: Node | null = null;

    protected onLoad(): void {
        this._root = this.rootNode ?? this.node;
    }

    public show(): void {
        const root = this._getRoot();
        if (!root) {
            return;
        }

        root.active = true;
        this.setProgress(0);
    }

    public hide(): void {
        const root = this._getRoot();
        if (root) {
            root.active = false;
        }
    }

    public reset(): void {
        this.setProgress(0);
        this.hide();
    }

    public setProgress(ratio: number): void {
        const clamped = Math.max(0, Math.min(1, ratio));

        if (this.fillSprite) {
            this.fillSprite.fillRange = clamped;
        }

        if (this.progressBar) {
            this.progressBar.progress = clamped;
        }
    }

    public isVisible(): boolean {
        const root = this._getRoot();
        return root ? root.active : false;
    }

    private _getRoot(): Node | null {
        if (!this._root) {
            this._root = this.rootNode ?? this.node;
        }
        return this._root;
    }
}
