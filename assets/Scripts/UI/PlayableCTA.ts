import {
    _decorator,
    Button,
    CCString,
    Component,
    Node,
} from 'cc';
import {
    PlayableEvent,
    PlayableEvents,
} from '../Core/PlayableEvents';

const { ccclass, property } = _decorator;

declare global {
    interface Window {
        mraid?: {
            open?: (url: string) => void;
        };
    }
}

@ccclass('PlayableCTA')
export class PlayableCTA extends Component {
    @property({
        type: CCString,
        tooltip: 'Store or landing page URL opened on click.',
    })
    public url = '';

    @property({
        tooltip: 'Open the URL in a new browser tab when supported.',
    })
    public openInNewTab = true;

    @property({
        type: Node,
        tooltip: 'Optional button node. Defaults to this node.',
    })
    public buttonNode: Node | null = null;

    @property({
        tooltip: 'Try window.mraid.open(url) before falling back to window.open.',
    })
    public useMraidWhenAvailable = true;

    @property
    public debugLogs = false;

    protected onEnable(): void {
        const node = this.buttonNode ?? this.node;
        if (this._getButton()) {
            node.on(Button.EventType.CLICK, this._onClick, this);
            return;
        }

        node.on(Node.EventType.TOUCH_END, this._onClick, this);
    }

    protected onDisable(): void {
        const node = this.buttonNode ?? this.node;
        if (this._getButton()) {
            node.off(Button.EventType.CLICK, this._onClick, this);
            return;
        }

        node.off(Node.EventType.TOUCH_END, this._onClick, this);
    }

    public openUrl(customUrl?: string): void {
        const targetUrl = (customUrl ?? this.url).trim();
        if (!targetUrl) {
            this._log('no url configured');
            return;
        }

        PlayableEvents.emit(PlayableEvent.CTA_CLICKED, { url: targetUrl });

        if (this.useMraidWhenAvailable && typeof window !== 'undefined') {
            const mraidOpen = window.mraid?.open;
            if (typeof mraidOpen === 'function') {
                mraidOpen(targetUrl);
                this._log('opened via mraid', targetUrl);
                return;
            }
        }

        if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(targetUrl, this.openInNewTab ? '_blank' : '_self');
            this._log('opened via window.open', targetUrl);
        }
    }

    private _onClick(): void {
        this.openUrl();
    }

    private _getButton(): Button | null {
        const node = this.buttonNode ?? this.node;
        return node.getComponent(Button);
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[PlayableCTA]', ...args);
    }
}
