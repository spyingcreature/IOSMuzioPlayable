import {
    _decorator,
    Button,
    Component,
    Node,
    Sprite,
    SpriteFrame,
} from 'cc';
import { AudioManager } from '../Audio/AudioManager';

const { ccclass, property } = _decorator;

@ccclass('MusicToggleButton')
export class MusicToggleButton extends Component {
    @property({
        type: Node,
        tooltip: 'Optional button node. Defaults to this node.',
    })
    public buttonNode: Node | null = null;

    @property({
        type: Sprite,
        tooltip: 'Sprite whose frame is swapped when music is toggled.',
    })
    public targetSprite: Sprite | null = null;

    @property({
        type: SpriteFrame,
        tooltip: 'Sprite shown while music is on.',
    })
    public musicOnSprite: SpriteFrame | null = null;

    @property({
        type: SpriteFrame,
        tooltip: 'Sprite shown while music is off.',
    })
    public musicOffSprite: SpriteFrame | null = null;

    @property({
        type: AudioManager,
        tooltip: 'AudioManager used to pause/resume music.',
    })
    public audioManager: AudioManager | null = null;

    @property({
        tooltip: 'Music key passed to AudioManager.playMusic() on start when music starts on.',
    })
    public musicTrackName = '';

    @property({
        tooltip: 'Initial music state. When true, music starts on and musicOnSprite is shown.',
    })
    public startMusicOn = true;

    @property
    public debugLogs = false;

    private _musicOn = true;

    protected onLoad(): void {
        this._musicOn = this.startMusicOn;
        this._applySprite();
        this._startMusicIfNeeded();
    }

    private _startMusicIfNeeded(): void {
        const audio = this.audioManager;
        if (!audio) {
            console.warn('[MusicToggleButton] audioManager is not assigned.');
            return;
        }

        if (!this._musicOn) {
            audio.pauseMusic();
            this._log('start muted');
            return;
        }

        const key = this.musicTrackName.trim();
        if (!key) {
            this._log('no musicTrackName configured; skipping playMusic on start');
            return;
        }

        audio.playMusic(key);
        this._log('playMusic on start', key);
    }

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

    public isMusicOn(): boolean {
        return this._musicOn;
    }

    public setMusicOn(enabled: boolean): void {
        if (this._musicOn === enabled) {
            this._applySprite();
            return;
        }

        this._musicOn = enabled;
        this._applyMusic();
        this._applySprite();
    }

    public toggleMusic(): void {
        this.setMusicOn(!this._musicOn);
    }

    private _onClick(): void {
        this.toggleMusic();
    }

    private _applyMusic(): void {
        const audio = this.audioManager;
        if (!audio) {
            console.warn('[MusicToggleButton] audioManager is not assigned.');
            return;
        }

        if (this._musicOn) {
            audio.resumeMusic();
            this._log('music on');
            return;
        }

        audio.pauseMusic();
        this._log('music off');
    }

    private _applySprite(): void {
        const sprite = this.targetSprite;
        if (!sprite) {
            return;
        }

        const frame = this._musicOn ? this.musicOnSprite : this.musicOffSprite;
        if (!frame) {
            this._log('missing sprite frame for state', this._musicOn ? 'on' : 'off');
            return;
        }

        sprite.spriteFrame = frame;
    }

    private _getButton(): Button | null {
        const node = this.buttonNode ?? this.node;
        return node.getComponent(Button);
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[MusicToggleButton]', ...args);
    }
}
