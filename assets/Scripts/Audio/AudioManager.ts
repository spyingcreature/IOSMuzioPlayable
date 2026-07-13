import {
    _decorator,
    AudioClip,
    AudioSource,
    CCString,
    Component,
    Node,
} from 'cc';
import { ScenarioManager } from '../Presentation/ScenarioManager_Cocos388';

const { ccclass, property } = _decorator;

interface PlayMusicEventPayload {
    key?: unknown;
    volume?: unknown;
    loop?: unknown;
    fadeDuration?: unknown;
}

interface PlaySfxEventPayload {
    key?: unknown;
    volume?: unknown;
}

interface PlayLoopingSfxEventPayload {
    key?: unknown;
    loopId?: unknown;
    volume?: unknown;
}

interface StopLoopingSfxEventPayload {
    loopId?: unknown;
    key?: unknown;
}

interface MusicFadeJob {
    duration: number;
    elapsed: number;
    fadeOutSource: AudioSource | null;
    fadeInSource: AudioSource | null;
    fromOutVolume: number;
    fromInVolume: number;
    toInVolume: number;
}

@ccclass('AudioManager')
export class AudioManager extends Component {
    @property({
        type: AudioSource,
        tooltip: 'AudioSource dedicated to background music playback.',
    })
    public musicSource: AudioSource | null = null;

    @property({
        type: AudioSource,
        tooltip: 'Second music AudioSource used for crossfading. Required for smooth fade between tracks.',
    })
    public secondaryMusicSource: AudioSource | null = null;

    @property({
        type: AudioSource,
        tooltip: 'AudioSource dedicated to SFX one-shot playback.',
    })
    public sfxSource: AudioSource | null = null;

    @property({
        type: [CCString],
        tooltip: 'Music keys matched by index with musicClips.',
    })
    public musicKeys: string[] = [];

    @property({
        type: [AudioClip],
        tooltip: 'Music clips matched by index with musicKeys.',
    })
    public musicClips: AudioClip[] = [];

    @property({
        type: [CCString],
        tooltip: 'SFX keys matched by index with sfxClips.',
    })
    public sfxKeys: string[] = [];

    @property({
        type: [AudioClip],
        tooltip: 'SFX clips matched by index with sfxKeys.',
    })
    public sfxClips: AudioClip[] = [];

    @property({
        min: 0,
        max: 1,
        tooltip: 'Fallback music volume when playMusic() volume is omitted.',
    })
    public defaultMusicVolume = 1;

    @property({
        tooltip: 'Default looping state used when playMusic() loop is omitted.',
    })
    public defaultMusicLoop = true;

    @property({
        min: 0,
        tooltip: 'Default duration (seconds) used by fadeToMusic() and event-based music fades.',
    })
    public defaultMusicFadeDuration = 0.5;

    @property({
        min: 0,
        max: 1,
        tooltip: 'Fallback SFX volume when playSfx() volume is omitted.',
    })
    public defaultSfxVolume = 1;

    @property({
        type: CCString,
        tooltip: 'Optional app event name for playMusic. Payload: string key or { key, volume?, loop? }.',
    })
    public playMusicEventName = 'audio:music';

    @property({
        type: CCString,
        tooltip: 'Optional app event name for stopMusic.',
    })
    public stopMusicEventName = 'audio:stopMusic';

    @property({
        type: CCString,
        tooltip: 'Optional app event name that always fades to a music key. Payload: string key or { key, volume?, loop?, fadeDuration? }.',
    })
    public fadeMusicEventName = 'audio:fadeMusic';

    @property({
        type: CCString,
        tooltip: 'Optional app event name for playSfx. Payload: string key or { key, volume? }.',
    })
    public playSfxEventName = 'audio:sfx';

    @property({
        type: CCString,
        tooltip: 'Optional app event name for stopAll.',
    })
    public stopAllEventName = 'audio:stopAll';

    @property({
        type: CCString,
        tooltip: 'Optional app event name for controllable looping SFX. Payload: string key or { key, loopId?, volume? }.',
    })
    public playLoopingSfxEventName = 'audio:sfxLoop';

    @property({
        type: CCString,
        tooltip: 'Optional app event name to stop one looping SFX by loop id/key. Payload: string or { loopId?, key? }.',
    })
    public stopLoopingSfxEventName = 'audio:stopSfxLoop';

    @property({
        type: CCString,
        tooltip: 'Optional app event name to stop all looping SFX.',
    })
    public stopAllLoopingSfxEventName = 'audio:stopAllSfxLoops';

    @property({
        min: 1,
        step: 1,
        tooltip: 'Maximum dynamically created AudioSources used by controllable looping SFX.',
    })
    public maxLoopingSfxSources = 4;

    @property
    public debugLogs = false;

    private readonly _musicClipMap = new Map<string, AudioClip>();
    private readonly _sfxClipMap = new Map<string, AudioClip>();

    private _activeMusicSource: AudioSource | null = null;
    private _inactiveMusicSource: AudioSource | null = null;
    private _musicFadeJob: MusicFadeJob | null = null;

    private _loopingSfxContainer: Node | null = null;
    private readonly _loopingSfxPool: AudioSource[] = [];
    private readonly _idleLoopingSfxSources: AudioSource[] = [];
    private readonly _loopingSfxById = new Map<string, AudioSource>();
    private readonly _loopingSfxIdBySource = new Map<AudioSource, string>();

    private _boundPlayMusicEventName = '';
    private _boundStopMusicEventName = '';
    private _boundFadeMusicEventName = '';
    private _boundPlaySfxEventName = '';
    private _boundStopAllEventName = '';
    private _boundPlayLoopingSfxEventName = '';
    private _boundStopLoopingSfxEventName = '';
    private _boundStopAllLoopingSfxEventName = '';

    protected onLoad(): void {
        this._autoAssignSourcesIfNeeded();
        this._initializeMusicSources();
        this.rebuildClipMaps();
    }

    protected update(deltaTime: number): void {
        this._updateMusicFade(deltaTime);
    }

    protected onEnable(): void {
        this._bindOptionalEvents();
    }

    protected onDisable(): void {
        this._unbindOptionalEvents();
        this._cancelMusicFade(false);
    }

    protected onDestroy(): void {
        this._unbindOptionalEvents();
        this._cancelMusicFade(false);
        this.stopAllLoopingSfx();
    }

    public rebuildClipMaps(): void {
        this._musicClipMap.clear();
        this._sfxClipMap.clear();

        this._populateClipMap(this.musicKeys, this.musicClips, this._musicClipMap, 'music');
        this._populateClipMap(this.sfxKeys, this.sfxClips, this._sfxClipMap, 'sfx');
    }

    public playMusic(key: string, volume?: number, loop?: boolean): boolean {
        const source = this._resolvePrimaryMusicSource();
        if (!source) {
            console.warn('[AudioManager] musicSource is not assigned.');
            return false;
        }

        const clip = this._getClipByKey(key, this._musicClipMap, 'music');
        if (!clip) {
            return false;
        }

        this._cancelMusicFade(false);
        source.stop();
        source.clip = clip;
        source.loop = loop ?? this.defaultMusicLoop;
        source.volume = this._sanitizeVolume(volume, this.defaultMusicVolume);
        source.play();
        this._activeMusicSource = source;

        if (this._inactiveMusicSource) {
            this._inactiveMusicSource.stop();
            this._inactiveMusicSource.volume = 0;
        }

        this._log('playMusic', { key, volume: source.volume, loop: source.loop });
        return true;
    }

    public fadeToMusic(
        key: string,
        duration = this.defaultMusicFadeDuration,
        volume?: number,
        loop?: boolean,
    ): boolean {
        const nextClip = this._getClipByKey(key, this._musicClipMap, 'music');
        if (!nextClip) {
            return false;
        }

        const safeDuration = Math.max(0, duration || 0);
        if (safeDuration <= 0) {
            return this.playMusic(key, volume, loop);
        }

        this._ensureMusicSourceState();
        const fadeInSource = this._getFadeInMusicSource();
        if (!fadeInSource) {
            return this.playMusic(key, volume, loop);
        }

        const fadeOutSource = this._activeMusicSource;
        const nextVolume = this._sanitizeVolume(volume, this.defaultMusicVolume);
        const nextLoop = loop ?? this.defaultMusicLoop;
        this._cancelMusicFade(false);

        // If currently active source already plays this clip, fade its own volume.
        if (fadeOutSource && fadeOutSource.clip === nextClip) {
            this._musicFadeJob = {
                duration: safeDuration,
                elapsed: 0,
                fadeOutSource: null,
                fadeInSource: fadeOutSource,
                fromOutVolume: 0,
                fromInVolume: fadeOutSource.volume,
                toInVolume: nextVolume,
            };
            fadeOutSource.loop = nextLoop;
            this._activeMusicSource = fadeOutSource;
            this._inactiveMusicSource = this._getOtherMusicSource(fadeOutSource);
            this._log('fadeToMusic (same clip)', { key, duration: safeDuration, volume: nextVolume });
            return true;
        }

        fadeInSource.stop();
        fadeInSource.clip = nextClip;
        fadeInSource.loop = nextLoop;
        fadeInSource.volume = 0;
        fadeInSource.play();

        this._musicFadeJob = {
            duration: safeDuration,
            elapsed: 0,
            fadeOutSource,
            fadeInSource,
            fromOutVolume: fadeOutSource ? fadeOutSource.volume : 0,
            fromInVolume: 0,
            toInVolume: nextVolume,
        };

        this._activeMusicSource = fadeInSource;
        this._inactiveMusicSource = this._getOtherMusicSource(fadeInSource);
        this._log('fadeToMusic', { key, duration: safeDuration, volume: nextVolume, loop: nextLoop });
        return true;
    }

    public stopMusicFade(duration = this.defaultMusicFadeDuration): void {
        const source = this._activeMusicSource;
        if (!source) {
            return;
        }

        const safeDuration = Math.max(0, duration || 0);
        if (safeDuration <= 0) {
            this.stopMusic();
            return;
        }

        this._cancelMusicFade(false);
        this._musicFadeJob = {
            duration: safeDuration,
            elapsed: 0,
            fadeOutSource: source,
            fadeInSource: null,
            fromOutVolume: source.volume,
            fromInVolume: 0,
            toInVolume: 0,
        };
        this._log('stopMusicFade', { duration: safeDuration });
    }

    public isMusicFading(): boolean {
        return !!this._musicFadeJob;
    }

    public stopMusic(): void {
        this._cancelMusicFade(false);
        this.musicSource?.stop();
        this.secondaryMusicSource?.stop();
        if (this.musicSource) {
            this.musicSource.volume = 0;
        }
        if (this.secondaryMusicSource) {
            this.secondaryMusicSource.volume = 0;
        }
        this._log('stopMusic');
    }

    public pauseMusic(): void {
        this.musicSource?.pause();
        this.secondaryMusicSource?.pause();
        this._log('pauseMusic');
    }

    public resumeMusic(): void {
        this.musicSource?.play();
        this.secondaryMusicSource?.play();
        this._log('resumeMusic');
    }

    public setMusicVolume(volume: number): void {
        const nextVolume = this._sanitizeVolume(volume, this.defaultMusicVolume);
        this.defaultMusicVolume = nextVolume;

        const activeSource = this._activeMusicSource;
        if (activeSource) {
            activeSource.volume = nextVolume;
        } else if (this.musicSource) {
            this.musicSource.volume = nextVolume;
        }

        if (this._musicFadeJob) {
            this._musicFadeJob.toInVolume = nextVolume;
        }

        this._log('setMusicVolume', nextVolume);
    }

    public playSfx(key: string, volume?: number): boolean {
        const source = this.sfxSource ?? this.musicSource;
        if (!source) {
            console.warn('[AudioManager] Neither sfxSource nor musicSource is assigned.');
            return false;
        }

        const clip = this._getClipByKey(key, this._sfxClipMap, 'sfx');
        if (!clip) {
            return false;
        }

        source.playOneShot(clip, this._sanitizeVolume(volume, this.defaultSfxVolume));
        this._log('playSfx', { key, volume: this._sanitizeVolume(volume, this.defaultSfxVolume) });
        return true;
    }

    public stopAllSfx(): void {
        this.sfxSource?.stop();
        this.stopAllLoopingSfx();
        this._log('stopAllSfx');
    }

    public playLoopingSfx(
        key: string,
        loopId?: string,
        volume?: number,
    ): boolean {
        const clip = this._getClipByKey(key, this._sfxClipMap, 'sfx');
        if (!clip) {
            return false;
        }

        const resolvedLoopId = this._resolveLoopId(loopId, key);
        if (!resolvedLoopId) {
            console.warn('[AudioManager] Cannot play looping sfx: empty loop id/key.');
            return false;
        }

        let source = this._loopingSfxById.get(resolvedLoopId) ?? null;
        if (!source) {
            source = this._acquireLoopingSfxSource();
            if (!source) {
                console.warn('[AudioManager] Looping SFX pool limit reached.', this.maxLoopingSfxSources);
                return false;
            }
        }

        this._detachLoopingSourceFromPreviousId(source);
        this._loopingSfxById.set(resolvedLoopId, source);
        this._loopingSfxIdBySource.set(source, resolvedLoopId);

        source.stop();
        source.clip = clip;
        source.loop = true;
        source.volume = this._sanitizeVolume(volume, this.defaultSfxVolume);
        source.play();

        this._log('playLoopingSfx', { key, loopId: resolvedLoopId, volume: source.volume });
        return true;
    }

    public stopLoopingSfx(loopIdOrKey: string): void {
        const resolved = loopIdOrKey.trim();
        if (!resolved) {
            return;
        }

        const source = this._loopingSfxById.get(resolved);
        if (!source) {
            return;
        }

        this._releaseLoopingSfxSource(source);
        this._log('stopLoopingSfx', resolved);
    }

    public stopAllLoopingSfx(): void {
        const activeSources = Array.from(this._loopingSfxById.values());
        for (const source of activeSources) {
            this._releaseLoopingSfxSource(source);
        }
        this._log('stopAllLoopingSfx');
    }

    public isLoopingSfxPlaying(loopIdOrKey: string): boolean {
        const resolved = loopIdOrKey.trim();
        if (!resolved) {
            return false;
        }
        return this._loopingSfxById.has(resolved);
    }

    public stopAll(): void {
        this.stopMusic();
        this.stopAllSfx();
        this._log('stopAll');
    }

    private _populateClipMap(
        keys: string[],
        clips: AudioClip[],
        destination: Map<string, AudioClip>,
        channel: 'music' | 'sfx',
    ): void {
        const count = Math.min(keys.length, clips.length);
        for (let i = 0; i < count; i++) {
            const key = keys[i]?.trim();
            const clip = clips[i];

            if (!key) {
                this._log(`Skipped ${channel} index ${i}: empty key.`);
                continue;
            }

            if (!clip) {
                this._log(`Skipped ${channel} key "${key}": missing clip.`);
                continue;
            }

            if (destination.has(key)) {
                console.warn(`[AudioManager] Duplicate ${channel} key "${key}" at index ${i}.`);
                continue;
            }

            destination.set(key, clip);
        }
    }

    private _getClipByKey(
        key: string,
        source: Map<string, AudioClip>,
        channel: 'music' | 'sfx',
    ): AudioClip | null {
        const safeKey = key.trim();
        if (!safeKey) {
            console.warn(`[AudioManager] Cannot play ${channel}: empty key.`);
            return null;
        }

        const clip = source.get(safeKey);
        if (!clip) {
            console.warn(`[AudioManager] ${channel} key not found: "${safeKey}".`);
            return null;
        }

        return clip;
    }

    private _bindOptionalEvents(): void {
        this._unbindOptionalEvents();

        const playMusicName = this.playMusicEventName.trim();
        const stopMusicName = this.stopMusicEventName.trim();
        const fadeMusicName = this.fadeMusicEventName.trim();
        const playSfxName = this.playSfxEventName.trim();
        const stopAllName = this.stopAllEventName.trim();
        const playLoopingSfxName = this.playLoopingSfxEventName.trim();
        const stopLoopingSfxName = this.stopLoopingSfxEventName.trim();
        const stopAllLoopingSfxName = this.stopAllLoopingSfxEventName.trim();

        if (playMusicName) {
            ScenarioManager.events.on(playMusicName, this._onPlayMusicEvent, this);
            this._boundPlayMusicEventName = playMusicName;
        }

        if (stopMusicName) {
            ScenarioManager.events.on(stopMusicName, this._onStopMusicEvent, this);
            this._boundStopMusicEventName = stopMusicName;
        }

        if (fadeMusicName) {
            ScenarioManager.events.on(fadeMusicName, this._onFadeMusicEvent, this);
            this._boundFadeMusicEventName = fadeMusicName;
        }

        if (playSfxName) {
            ScenarioManager.events.on(playSfxName, this._onPlaySfxEvent, this);
            this._boundPlaySfxEventName = playSfxName;
        }

        if (stopAllName) {
            ScenarioManager.events.on(stopAllName, this._onStopAllEvent, this);
            this._boundStopAllEventName = stopAllName;
        }

        if (playLoopingSfxName) {
            ScenarioManager.events.on(playLoopingSfxName, this._onPlayLoopingSfxEvent, this);
            this._boundPlayLoopingSfxEventName = playLoopingSfxName;
        }

        if (stopLoopingSfxName) {
            ScenarioManager.events.on(stopLoopingSfxName, this._onStopLoopingSfxEvent, this);
            this._boundStopLoopingSfxEventName = stopLoopingSfxName;
        }

        if (stopAllLoopingSfxName) {
            ScenarioManager.events.on(stopAllLoopingSfxName, this._onStopAllLoopingSfxEvent, this);
            this._boundStopAllLoopingSfxEventName = stopAllLoopingSfxName;
        }
    }

    private _unbindOptionalEvents(): void {
        if (this._boundPlayMusicEventName) {
            ScenarioManager.events.off(this._boundPlayMusicEventName, this._onPlayMusicEvent, this);
            this._boundPlayMusicEventName = '';
        }

        if (this._boundStopMusicEventName) {
            ScenarioManager.events.off(this._boundStopMusicEventName, this._onStopMusicEvent, this);
            this._boundStopMusicEventName = '';
        }

        if (this._boundFadeMusicEventName) {
            ScenarioManager.events.off(this._boundFadeMusicEventName, this._onFadeMusicEvent, this);
            this._boundFadeMusicEventName = '';
        }

        if (this._boundPlaySfxEventName) {
            ScenarioManager.events.off(this._boundPlaySfxEventName, this._onPlaySfxEvent, this);
            this._boundPlaySfxEventName = '';
        }

        if (this._boundStopAllEventName) {
            ScenarioManager.events.off(this._boundStopAllEventName, this._onStopAllEvent, this);
            this._boundStopAllEventName = '';
        }

        if (this._boundPlayLoopingSfxEventName) {
            ScenarioManager.events.off(
                this._boundPlayLoopingSfxEventName,
                this._onPlayLoopingSfxEvent,
                this,
            );
            this._boundPlayLoopingSfxEventName = '';
        }

        if (this._boundStopLoopingSfxEventName) {
            ScenarioManager.events.off(
                this._boundStopLoopingSfxEventName,
                this._onStopLoopingSfxEvent,
                this,
            );
            this._boundStopLoopingSfxEventName = '';
        }

        if (this._boundStopAllLoopingSfxEventName) {
            ScenarioManager.events.off(
                this._boundStopAllLoopingSfxEventName,
                this._onStopAllLoopingSfxEvent,
                this,
            );
            this._boundStopAllLoopingSfxEventName = '';
        }
    }

    private _onPlayMusicEvent(payload?: unknown): void {
        const parsed = this._parsePlayMusicPayload(payload);
        if (!parsed) {
            return;
        }
        const fadeDuration = parsed.fadeDuration;
        if (typeof fadeDuration === 'number' && fadeDuration > 0) {
            this.fadeToMusic(parsed.key, fadeDuration, parsed.volume, parsed.loop);
            return;
        }
        this.playMusic(parsed.key, parsed.volume, parsed.loop);
    }

    private _onStopMusicEvent(): void {
        this.stopMusic();
    }

    private _onFadeMusicEvent(payload?: unknown): void {
        const parsed = this._parsePlayMusicPayload(payload);
        if (!parsed) {
            return;
        }
        this.fadeToMusic(
            parsed.key,
            parsed.fadeDuration ?? this.defaultMusicFadeDuration,
            parsed.volume,
            parsed.loop,
        );
    }

    private _onPlaySfxEvent(payload?: unknown): void {
        const parsed = this._parsePlaySfxPayload(payload);
        if (!parsed) {
            return;
        }
        this.playSfx(parsed.key, parsed.volume);
    }

    private _onStopAllEvent(): void {
        this.stopAll();
    }

    private _onPlayLoopingSfxEvent(payload?: unknown): void {
        const parsed = this._parsePlayLoopingSfxPayload(payload);
        if (!parsed) {
            return;
        }
        this.playLoopingSfx(parsed.key, parsed.loopId, parsed.volume);
    }

    private _onStopLoopingSfxEvent(payload?: unknown): void {
        const loopId = this._parseStopLoopingSfxPayload(payload);
        if (!loopId) {
            return;
        }
        this.stopLoopingSfx(loopId);
    }

    private _onStopAllLoopingSfxEvent(): void {
        this.stopAllLoopingSfx();
    }

    private _parsePlayMusicPayload(
        payload?: unknown,
    ): { key: string; volume?: number; loop?: boolean; fadeDuration?: number } | null {
        if (typeof payload === 'string') {
            const key = payload.trim();
            return key ? { key } : null;
        }

        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const source = payload as PlayMusicEventPayload;
        const key = typeof source.key === 'string' ? source.key.trim() : '';
        if (!key) {
            return null;
        }

        const volume = typeof source.volume === 'number' ? source.volume : undefined;
        const loop = typeof source.loop === 'boolean' ? source.loop : undefined;
        const fadeDuration = typeof source.fadeDuration === 'number'
            ? Math.max(0, source.fadeDuration)
            : undefined;
        return { key, volume, loop, fadeDuration };
    }

    private _parsePlaySfxPayload(
        payload?: unknown,
    ): { key: string; volume?: number } | null {
        if (typeof payload === 'string') {
            const key = payload.trim();
            return key ? { key } : null;
        }

        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const source = payload as PlaySfxEventPayload;
        const key = typeof source.key === 'string' ? source.key.trim() : '';
        if (!key) {
            return null;
        }

        const volume = typeof source.volume === 'number' ? source.volume : undefined;
        return { key, volume };
    }

    private _parsePlayLoopingSfxPayload(
        payload?: unknown,
    ): { key: string; loopId?: string; volume?: number } | null {
        if (typeof payload === 'string') {
            const key = payload.trim();
            return key ? { key } : null;
        }

        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const source = payload as PlayLoopingSfxEventPayload;
        const key = typeof source.key === 'string' ? source.key.trim() : '';
        if (!key) {
            return null;
        }

        const loopId = typeof source.loopId === 'string'
            ? source.loopId.trim()
            : undefined;
        const volume = typeof source.volume === 'number' ? source.volume : undefined;
        return { key, loopId, volume };
    }

    private _parseStopLoopingSfxPayload(payload?: unknown): string {
        if (typeof payload === 'string') {
            return payload.trim();
        }

        if (!payload || typeof payload !== 'object') {
            return '';
        }

        const source = payload as StopLoopingSfxEventPayload;
        const loopId = typeof source.loopId === 'string' ? source.loopId.trim() : '';
        if (loopId) {
            return loopId;
        }
        const key = typeof source.key === 'string' ? source.key.trim() : '';
        return key;
    }

    private _autoAssignSourcesIfNeeded(): void {
        if (this.musicSource && this.sfxSource && this.secondaryMusicSource) {
            return;
        }

        const sources = this.getComponents(AudioSource);
        if (!this.musicSource) {
            this.musicSource = sources[0] ?? null;
        }
        if (!this.sfxSource) {
            const sfxCandidate = sources.find((source) => source !== this.musicSource) ?? null;
            this.sfxSource = sfxCandidate ?? this.musicSource;
        }
        if (!this.secondaryMusicSource) {
            this.secondaryMusicSource = sources.find(
                (source) => source !== this.musicSource && source !== this.sfxSource,
            ) ?? null;
        }
    }

    private _initializeMusicSources(): void {
        this._activeMusicSource = this.musicSource;
        this._inactiveMusicSource = this.secondaryMusicSource;

        if (this._inactiveMusicSource) {
            this._inactiveMusicSource.stop();
            this._inactiveMusicSource.volume = 0;
        }
    }

    private _ensureMusicSourceState(): void {
        if (!this._activeMusicSource && this.musicSource) {
            this._activeMusicSource = this.musicSource;
        }

        if (!this._inactiveMusicSource) {
            this._inactiveMusicSource = this._getOtherMusicSource(this._activeMusicSource);
        }
    }

    private _resolvePrimaryMusicSource(): AudioSource | null {
        if (!this.musicSource) {
            return null;
        }
        this._activeMusicSource = this.musicSource;
        this._inactiveMusicSource = this.secondaryMusicSource;
        return this.musicSource;
    }

    private _getFadeInMusicSource(): AudioSource | null {
        if (!this.musicSource) {
            return null;
        }

        if (!this.secondaryMusicSource) {
            return null;
        }

        const active = this._activeMusicSource ?? this.musicSource;
        if (active === this.musicSource) {
            return this.secondaryMusicSource;
        }
        return this.musicSource;
    }

    private _getOtherMusicSource(source: AudioSource | null): AudioSource | null {
        if (!source) {
            return null;
        }

        if (source === this.musicSource) {
            return this.secondaryMusicSource;
        }

        if (source === this.secondaryMusicSource) {
            return this.musicSource;
        }

        return null;
    }

    private _updateMusicFade(deltaTime: number): void {
        const job = this._musicFadeJob;
        if (!job) {
            return;
        }

        job.elapsed += Math.max(0, deltaTime);
        const t = job.duration <= 0
            ? 1
            : Math.min(1, job.elapsed / job.duration);

        if (job.fadeOutSource) {
            job.fadeOutSource.volume = this._lerp(job.fromOutVolume, 0, t);
        }

        if (job.fadeInSource) {
            job.fadeInSource.volume = this._lerp(job.fromInVolume, job.toInVolume, t);
        }

        if (t < 1) {
            return;
        }

        if (job.fadeOutSource) {
            job.fadeOutSource.stop();
            job.fadeOutSource.volume = 0;
        }

        if (job.fadeInSource) {
            job.fadeInSource.volume = job.toInVolume;
            this._activeMusicSource = job.fadeInSource;
            this._inactiveMusicSource = this._getOtherMusicSource(job.fadeInSource);
        } else {
            this._activeMusicSource = this.musicSource;
            this._inactiveMusicSource = this.secondaryMusicSource;
        }

        this._musicFadeJob = null;
    }

    private _cancelMusicFade(completeCurrent: boolean): void {
        const job = this._musicFadeJob;
        if (!job) {
            return;
        }

        if (completeCurrent) {
            if (job.fadeOutSource) {
                job.fadeOutSource.stop();
                job.fadeOutSource.volume = 0;
            }
            if (job.fadeInSource) {
                job.fadeInSource.volume = job.toInVolume;
                this._activeMusicSource = job.fadeInSource;
                this._inactiveMusicSource = this._getOtherMusicSource(job.fadeInSource);
            }
        }

        this._musicFadeJob = null;
    }

    private _resolveLoopId(loopId: string | undefined, key: string): string {
        const explicitId = loopId?.trim() ?? '';
        if (explicitId) {
            return explicitId;
        }
        return key.trim();
    }

    private _acquireLoopingSfxSource(): AudioSource | null {
        const reused = this._idleLoopingSfxSources.pop();
        if (reused) {
            return reused;
        }

        const safeMax = Math.max(1, Math.floor(this.maxLoopingSfxSources));
        if (this._loopingSfxPool.length >= safeMax) {
            return null;
        }

        const parent = this._getLoopingSfxContainer();
        const sourceNode = new Node(`LoopingSfxSource_${this._loopingSfxPool.length + 1}`);
        parent.addChild(sourceNode);
        const source = sourceNode.addComponent(AudioSource);
        this._loopingSfxPool.push(source);
        return source;
    }

    private _getLoopingSfxContainer(): Node {
        if (this._loopingSfxContainer && this._loopingSfxContainer.isValid) {
            return this._loopingSfxContainer;
        }

        const existing = this.node.getChildByName('__LoopingSfxSources');
        if (existing) {
            this._loopingSfxContainer = existing;
            return existing;
        }

        const container = new Node('__LoopingSfxSources');
        this.node.addChild(container);
        this._loopingSfxContainer = container;
        return container;
    }

    private _detachLoopingSourceFromPreviousId(source: AudioSource): void {
        const previousId = this._loopingSfxIdBySource.get(source);
        if (!previousId) {
            return;
        }
        this._loopingSfxById.delete(previousId);
        this._loopingSfxIdBySource.delete(source);
    }

    private _releaseLoopingSfxSource(source: AudioSource): void {
        this._detachLoopingSourceFromPreviousId(source);
        source.stop();
        source.loop = false;
        source.volume = 1;
        source.clip = null;

        if (!this._idleLoopingSfxSources.includes(source)) {
            this._idleLoopingSfxSources.push(source);
        }
    }

    private _lerp(from: number, to: number, t: number): number {
        return from + (to - from) * t;
    }

    private _sanitizeVolume(volume: number | undefined, fallback: number): number {
        const source = typeof volume === 'number' ? volume : fallback;
        if (!Number.isFinite(source)) {
            return 1;
        }
        if (source <= 0) {
            return 0;
        }
        if (source >= 1) {
            return 1;
        }
        return source;
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[AudioManager]', ...args);
    }
}
