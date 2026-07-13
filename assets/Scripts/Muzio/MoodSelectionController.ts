import {
    _decorator,
    Button,
    Component,
    Event,
    Label,
    Node,
    tween,
    Tween,
    UIOpacity,
    Vec3,
} from 'cc';
import { AudioManager } from '../Audio/AudioManager';
import { ScenarioManager } from '../Presentation/ScenarioManager_Cocos388';
import {
    MuzioMood,
    MuzioPlayableEvent,
    normalizeMuzioMood,
} from './MuzioPlayableEvents';
import { MuzioPlaylistController } from './MuzioPlaylistController';

const { ccclass, property } = _decorator;

@ccclass('MoodSelectionController')
export class MoodSelectionController extends Component {
    @property({ type: Node })
    public relaxCard: Node | null = null;

    @property({ type: Node })
    public energyCard: Node | null = null;

    @property({ type: Node })
    public focusCard: Node | null = null;

    @property({ type: MuzioPlaylistController })
    public playlistController: MuzioPlaylistController | null = null;

    @property({ type: Label })
    public selectedMoodLabel: Label | null = null;

    @property({ type: AudioManager })
    public audioManager: AudioManager | null = null;

    @property
    public selectSfxKey = '';

    @property
    public selectedScale = 1.06;

    @property({ min: 0, max: 255 })
    public unselectedOpacity = 145;

    @property({ min: 0 })
    public selectionTweenDuration = 0.16;

    @property
    public debugLogs = false;

    public get selectedMood(): MuzioMood | null {
        return this._selectedMood;
    }

    private _selectedMood: MuzioMood | null = null;
    private _selectionEnabled = false;
    private readonly _baseScales = new Map<Node, Vec3>();
    private readonly _activeTweens = new Map<Node, Tween<Node>>();

    protected onLoad(): void {
        for (const card of this._getCards()) {
            this._baseScales.set(card, card.scale.clone());
            this._ensureOpacity(card).opacity = 255;
        }
        this.resetSelection();
    }

    protected onDisable(): void {
        this._stopAllTweens();
    }

    /** Called by the ScenarioManager immediately before the mood step waits for input. */
    public enableSelection(): void {
        this._selectionEnabled = true;
        this._setButtonsInteractable(true);
    }

    public disableSelection(): void {
        this._selectionEnabled = false;
        this._setButtonsInteractable(false);
    }

    public resetSelection(): void {
        this._selectedMood = null;
        this._selectionEnabled = false;
        this._stopAllTweens();

        for (const card of this._getCards()) {
            const baseScale = this._baseScales.get(card);
            if (baseScale) {
                card.setScale(baseScale);
            }
            this._ensureOpacity(card).opacity = 255;
        }

        if (this.selectedMoodLabel) {
            this.selectedMoodLabel.string = '';
        }

        this._setButtonsInteractable(false);
    }

    /** Inspector Button callback. Use customEventData: Relax, Energy, or Focus. */
    public onMoodButtonClicked(_event?: Event, customEventData = ''): void {
        this.selectMood(customEventData);
    }

    public selectRelax(): void {
        this.selectMood('Relax');
    }

    public selectEnergy(): void {
        this.selectMood('Energy');
    }

    public selectFocus(): void {
        this.selectMood('Focus');
    }

    public selectMood(value: string): void {
        if (!this._selectionEnabled || this._selectedMood) {
            return;
        }

        const mood = normalizeMuzioMood(value);
        if (!mood) {
            console.warn('[MoodSelectionController] Unsupported mood:', value);
            return;
        }

        this._selectedMood = mood;
        this.disableSelection();
        this._applySelectedVisual(mood);

        if (this.selectedMoodLabel) {
            this.selectedMoodLabel.string = mood;
        }

        this.playlistController?.selectMood(mood);

        if (this.audioManager && this.selectSfxKey.trim()) {
            this.audioManager.playSfx(this.selectSfxKey.trim());
        }

        ScenarioManager.events.emit(MuzioPlayableEvent.MOOD_SELECTED, { mood });
        this._log('selected', mood);
    }

    private _applySelectedVisual(selectedMood: MuzioMood): void {
        for (const card of this._getCards()) {
            const cardMood = this._getMoodForCard(card);
            const isSelected = cardMood === selectedMood;
            const opacity = this._ensureOpacity(card);
            opacity.opacity = isSelected ? 255 : this._clampOpacity(this.unselectedOpacity);

            const baseScale = this._baseScales.get(card) ?? new Vec3(1, 1, 1);
            const targetScale = isSelected
                ? new Vec3(
                    baseScale.x * this.selectedScale,
                    baseScale.y * this.selectedScale,
                    baseScale.z,
                )
                : baseScale.clone();

            this._stopTween(card);
            const duration = Math.max(0, this.selectionTweenDuration);
            if (duration <= 0) {
                card.setScale(targetScale);
                continue;
            }

            const activeTween = tween(card)
                .to(duration, { scale: targetScale }, { easing: 'backOut' })
                .call(() => this._activeTweens.delete(card))
                .start();
            this._activeTweens.set(card, activeTween);
        }
    }

    private _setButtonsInteractable(interactable: boolean): void {
        for (const card of this._getCards()) {
            const button = card.getComponent(Button);
            if (button) {
                button.interactable = interactable;
            }
        }
    }

    private _getCards(): Node[] {
        return [this.relaxCard, this.energyCard, this.focusCard].filter(
            (node): node is Node => !!node && node.isValid,
        );
    }

    private _getMoodForCard(card: Node): MuzioMood | null {
        if (card === this.relaxCard) {
            return 'Relax';
        }
        if (card === this.energyCard) {
            return 'Energy';
        }
        if (card === this.focusCard) {
            return 'Focus';
        }
        return null;
    }

    private _ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    private _stopTween(node: Node): void {
        const active = this._activeTweens.get(node);
        if (active) {
            active.stop();
            this._activeTweens.delete(node);
        }
    }

    private _stopAllTweens(): void {
        for (const [node, active] of this._activeTweens) {
            if (node?.isValid) {
                active.stop();
            }
        }
        this._activeTweens.clear();
    }

    private _clampOpacity(value: number): number {
        if (!Number.isFinite(value)) {
            return 255;
        }
        return Math.min(255, Math.max(0, Math.round(value)));
    }

    private _log(...args: unknown[]): void {
        if (this.debugLogs) {
            console.log('[MoodSelectionController]', ...args);
        }
    }
}
