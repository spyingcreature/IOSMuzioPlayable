import {
    _decorator,
    Component,
    Label,
    Node,
    ProgressBar,
    Rect,
    tween,
} from 'cc';
import { RelativeScalePulser } from '../Animation/RelativeScalePulser';
import { AudioManager } from '../Audio/AudioManager';
import { OverlapMode, ViewportBounds } from '../Detection/ViewportBounds';
import { ScenarioManager } from '../Presentation/ScenarioManager_Cocos388';
import {
    MuzioMood,
    MuzioPlayableEvent,
    normalizeMuzioMood,
} from './MuzioPlayableEvents';
import { PlaylistSongCard } from './PlaylistSongCard';

const { ccclass, property } = _decorator;

@ccclass('MuzioPlaylistController')
export class MuzioPlaylistController extends Component {
    @property({ type: Node })
    public relaxSongsRoot: Node | null = null;

    @property({ type: Node })
    public energySongsRoot: Node | null = null;

    @property({ type: Node })
    public focusSongsRoot: Node | null = null;


    @property({
        type: [PlaylistSongCard],
        tooltip: 'Optional explicit card list. Leave empty to auto-collect below the three mood roots.',
    })
    public songCards: PlaylistSongCard[] = [];

    @property({ type: ViewportBounds })
    public dropZone: ViewportBounds | null = null;

    @property({ type: Node })
    public dropHighlight: Node | null = null;

    @property({ type: RelativeScalePulser })
    public dropHighlightPulse: RelativeScalePulser | null = null;

    @property({ type: [Node] })
    public playlistSlots: Node[] = [];

    @property({ min: 1, max: 4, step: 1 })
    public requiredSongCount = 2;

    @property({ min: 0, max: 1 })
    public minimumDropOverlap = 0.25;

    @property({ type: Label })
    public moodLabel: Label | null = null;

    @property({ type: Label })
    public progressLabel: Label | null = null;

    @property({ type: Label })
    public endCardMoodLabel: Label | null = null;

    @property({ type: Label })
    public endCardTitleLabel: Label | null = null;

    @property
    public endCardTitleTemplate = 'Your {mood} mix is ready';

    @property({ type: Node })
    public dragHintRoot: Node | null = null;

    @property({ type: ProgressBar })
    public generationProgress: ProgressBar | null = null;

    @property({ type: AudioManager })
    public audioManager: AudioManager | null = null;

    @property
    public acceptedSfxKey = '';

    @property
    public rejectedSfxKey = '';

    @property
    public readySfxKey = '';

    @property
    public debugLogs = false;

    public get selectedMood(): MuzioMood | null {
        return this._selectedMood;
    }

    public get acceptedSongCount(): number {
        return this._acceptedCards.length;
    }

    private _selectedMood: MuzioMood | null = null;
    private _interactionEnabled = false;
    private _dropBusy = false;
    private readonly _allCards: PlaylistSongCard[] = [];
    private readonly _acceptedCards: PlaylistSongCard[] = [];
    private readonly _cardRect = new Rect();

    protected onLoad(): void {
        this._collectCards();
        this.resetPlayable();
    }

    public resetPlayable(): void {
        this._interactionEnabled = false;
        this._dropBusy = false;
        this._selectedMood = null;
        this._acceptedCards.length = 0;

        for (const card of this._allCards) {
            card.resetCard();
            card.setController(this);
        }

        this._setRootActive(this.relaxSongsRoot, false);
        this._setRootActive(this.energySongsRoot, false);
        this._setRootActive(this.focusSongsRoot, false);
        this._setDropHighlight(false);

        if (this.dragHintRoot) {
            this.dragHintRoot.active = false;
        }
        if (this.generationProgress) {
            this.generationProgress.progress = 0;
        }
        this._updateLabels();
    }

    public selectMood(value: string): void {
        const mood = normalizeMuzioMood(value);
        if (!mood) {
            console.warn('[MuzioPlaylistController] Unsupported mood:', value);
            return;
        }

        this._selectedMood = mood;
        this._setRootActive(this.relaxSongsRoot, mood === 'Relax');
        this._setRootActive(this.energySongsRoot, mood === 'Energy');
        this._setRootActive(this.focusSongsRoot, mood === 'Focus');

        for (const card of this._allCards) {
            card.setController(this);
            card.setDragEnabled(false);
        }

        this._updateLabels();
        this._log('mood prepared', mood);
    }

    /** Called by the scenario only after the playlist-ready event listener is armed. */
    public beginSongSelection(): void {
        if (!this._selectedMood) {
            console.warn('[MuzioPlaylistController] beginSongSelection called before a mood was selected.');
            return;
        }

        this._interactionEnabled = true;
        for (const card of this._getCardsForMood(this._selectedMood)) {
            card.setDragEnabled(!card.isAccepted);
        }

        if (this.dragHintRoot) {
            this.dragHintRoot.active = true;
        }
        this._updateLabels();
    }

    public disableSongDragging(): void {
        this._interactionEnabled = false;
        for (const card of this._allCards) {
            card.setDragEnabled(false);
        }
        this._setDropHighlight(false);
    }

    public onCardDragStarted(card: PlaylistSongCard): void {
        if (!this._canUseCard(card)) {
            return;
        }
        this._setDropHighlight(true);
    }

    public async handleCardDropped(card: PlaylistSongCard): Promise<void> {
        this._setDropHighlight(false);

        if (this._dropBusy || !this._canUseCard(card)) {
            await card.returnToSource();
            return;
        }

        if (!this._isInsideDropZone(card)) {
            this._playSfx(this.rejectedSfxKey);
            await card.returnToSource();
            return;
        }

        const requiredCount = this._getRequiredCount();
        const slot = this.playlistSlots[this._acceptedCards.length];
        if (!slot || this._acceptedCards.length >= requiredCount) {
            await card.returnToSource();
            return;
        }

        this._dropBusy = true;
        await card.snapInto(slot);
        this._acceptedCards.push(card);
        this._dropBusy = false;

        this._playSfx(this.acceptedSfxKey);
        this._updateLabels();

        ScenarioManager.events.emit(MuzioPlayableEvent.SONG_ADDED, {
            songId: card.cardId,
            mood: this._selectedMood,
            count: this._acceptedCards.length,
            requiredCount,
        });

        if (this._acceptedCards.length >= requiredCount) {
            this.disableSongDragging();
            if (this.dragHintRoot) {
                this.dragHintRoot.active = false;
            }
            this._playSfx(this.readySfxKey);
            ScenarioManager.events.emit(MuzioPlayableEvent.PLAYLIST_READY, {
                mood: this._selectedMood,
                songIds: this._acceptedCards.map(
                    (acceptedCard) => acceptedCard.cardId,
                ),
            });
        }
    }

    /**
     * Runs while the generating overlay is visible.
     * The end card remains inactive during this method.
     * Labels are prepared before the scenario activates the end card.
     */
    public async generatePlaylist(): Promise<void> {
        this.disableSongDragging();

        if (this.generationProgress) {
            this.generationProgress.progress = 0;
            await this._animateProgressBar(this.generationProgress, 1, 0.65);
        } else {
            await this._wait(0.65);
        }

        this._updateEndCardLabels();

        ScenarioManager.events.emit(MuzioPlayableEvent.PLAYLIST_GENERATED, {
            mood: this._selectedMood,
            songIds: this._acceptedCards.map(
                (card) => card.cardId,
            ),
        });
    }

    private _canUseCard(card: PlaylistSongCard): boolean {
        return this._interactionEnabled
            && !card.isAccepted
            && !!this._selectedMood
            && card.normalizedMood === this._selectedMood;
    }

    private _isInsideDropZone(card: PlaylistSongCard): boolean {
        if (!this.dropZone) {
            return false;
        }
        card.getWorldRect(this._cardRect);
        return this.dropZone.overlapsRect(
            this._cardRect,
            OverlapMode.OverlapPercent,
            Math.min(1, Math.max(0, this.minimumDropOverlap)),
        );
    }

    private _collectCards(): void {
        this._allCards.length = 0;
        const unique = new Set<PlaylistSongCard>();
        const addCard = (card: PlaylistSongCard | null | undefined): void => {
            if (!card || !card.isValid || unique.has(card)) {
                return;
            }
            card.ensureInitialized();
            unique.add(card);
            this._allCards.push(card);
        };

        if (this.songCards.length > 0) {
            for (const card of this.songCards) {
                addCard(card);
            }
            return;
        }

        for (const root of [this.relaxSongsRoot, this.energySongsRoot, this.focusSongsRoot]) {
            if (!root) {
                continue;
            }
            for (const card of root.getComponentsInChildren(PlaylistSongCard)) {
                addCard(card);
            }
        }
    }

    private _getCardsForMood(mood: MuzioMood): PlaylistSongCard[] {
        return this._allCards.filter((card) => card.normalizedMood === mood);
    }

    private _getRequiredCount(): number {
        const slotLimit = Math.max(1, this.playlistSlots.length);
        return Math.min(
            slotLimit,
            Math.max(1, Math.floor(this.requiredSongCount)),
        );
    }

    private _updateLabels(): void {
        const required = this._getRequiredCount();
        if (this.moodLabel) {
            this.moodLabel.string = this._selectedMood ?? '';
        }
        if (this.progressLabel) {
            this.progressLabel.string = `${this._acceptedCards.length}/${required}`;
        }
        this._updateEndCardLabels();
    }

    private _updateEndCardLabels(): void {
        const mood = this._selectedMood ?? '';
        if (this.endCardMoodLabel) {
            this.endCardMoodLabel.string = mood;
        }
        if (this.endCardTitleLabel) {
            this.endCardTitleLabel.string = this.endCardTitleTemplate.replace(
                /\{mood\}/g,
                mood,
            );
        }
    }

    private _setDropHighlight(visible: boolean): void {
        if (this.dropHighlight) {
            this.dropHighlight.active = visible;
        }
        if (visible) {
            this.dropHighlightPulse?.pulseWithConfig(
                1,
                0.45,
                false,
                [1.04, 1.04, 1],
                'sineInOut',
                true,
            );
        } else {
            this.dropHighlightPulse?.stopPulse(true);
        }
    }

    private _setRootActive(root: Node | null, active: boolean): void {
        if (root) {
            root.active = active;
        }
    }

    private _playSfx(key: string): void {
        const safeKey = key.trim();
        if (safeKey && this.audioManager) {
            this.audioManager.playSfx(safeKey);
        }
    }


    private _animateProgressBar(
        progressBar: ProgressBar,
        targetProgress: number,
        duration: number,
    ): Promise<void> {
        const safeTarget = Math.min(1, Math.max(0, targetProgress));
        const safeDuration = Math.max(0, duration);

        if (safeDuration <= 0) {
            progressBar.progress = safeTarget;
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            tween(progressBar)
                .to(
                    safeDuration,
                    { progress: safeTarget },
                    { easing: 'sineInOut' },
                )
                .call(resolve)
                .start();
        });
    }

    private _wait(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.scheduleOnce(resolve, Math.max(0, seconds));
        });
    }

    private _log(...args: unknown[]): void {
        if (this.debugLogs) {
            console.log('[MuzioPlaylistController]', ...args);
        }
    }
}
