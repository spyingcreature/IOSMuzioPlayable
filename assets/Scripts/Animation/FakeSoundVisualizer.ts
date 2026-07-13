import {
    _decorator,
    Component,
    instantiate,
    Node,
    UITransform,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

interface BarRuntime {
    node: Node;
    phase: number;
    frequency: number;
    phase2: number;
    frequency2: number;
    minScaleY: number;
    maxScaleY: number;
}

/**
 * Lightweight fake audio visualizer for playable ads.
 * Drives N odd bars with a single update loop (no per-bar tweens).
 */
@ccclass('FakeSoundVisualizer')
export class FakeSoundVisualizer extends Component {
    @property({
        type: Node,
        tooltip: 'Bar template node (Sprite/UI). Cloned for each bar. Prefer anchorY = 0 so bars grow upward.',
    })
    public barTemplate: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Parent for generated bars. Defaults to this node.',
    })
    public container: Node | null = null;

    @property({
        min: 5,
        step: 2,
        tooltip: 'Number of bars. Must be odd and greater than 3 (5, 7, 9...).',
    })
    public barCount = 5;

    @property({
        tooltip: 'Start in paused state. Call play() / unpause() to animate.',
    })
    public startPaused = false;

    @property({
        tooltip: 'Rebuild bars automatically on start.',
    })
    public rebuildOnStart = true;

    @property({
        min: 0,
        tooltip: 'Horizontal gap between bar centers (world/local units).',
    })
    public barSpacing = 12;

    @property({
        min: 0.01,
        tooltip: 'Minimum Y scale while animating.',
    })
    public minScaleY = 0.2;

    @property({
        min: 0.01,
        tooltip: 'Maximum Y scale for middle bars.',
    })
    public maxScaleY = 1;

    @property({
        min: 0.01,
        tooltip: 'Maximum Y scale for the first and last bars (kept shorter).',
    })
    public edgeMaxScaleY = 0.45;

    @property({
        min: 0.1,
        tooltip: 'Lowest oscillation frequency (Hz-ish).',
    })
    public minFrequency = 1.5;

    @property({
        min: 0.1,
        tooltip: 'Highest oscillation frequency (Hz-ish).',
    })
    public maxFrequency = 5.5;

    @property({
        min: 0,
        tooltip: 'Global speed multiplier for all bar frequencies.',
    })
    public speed = 1;

    @property({
        tooltip: 'If true, forces UITransform.anchorY = 0 on each bar so scale grows upward.',
    })
    public forceBottomAnchor = true;

    @property({
        tooltip: 'Hide the original bar template after bars are built.',
    })
    public hideTemplate = true;

    @property
    public debugLogs = false;

    private readonly _bars: BarRuntime[] = [];
    private readonly _scaleScratch = new Vec3(1, 1, 1);
    private _paused = true;
    private _built = false;

    protected onLoad(): void {
        this._paused = this.startPaused;
    }

    protected start(): void {
        if (this.rebuildOnStart) {
            this.rebuild();
        }

        if (!this._paused && this._bars.length > 0) {
            this._log('playing on start');
        }
    }

    protected onDisable(): void {
        this.pause();
    }

    protected update(dt: number): void {
        if (this._paused || this._bars.length === 0) {
            return;
        }

        this._applyFrame(dt);
    }

    public get isPaused(): boolean {
        return this._paused;
    }

    public get isPlaying(): boolean {
        return !this._paused && this._bars.length > 0;
    }

    /** Start / resume animation. */
    public play(): void {
        this.unpause();
    }

    /** Alias for play(). */
    public unpause(): void {
        if (!this._built) {
            this.rebuild();
        }

        this._paused = false;
        this._log('unpaused');
    }

    /** Freeze bars at their current heights. */
    public pause(): void {
        if (this._paused) {
            return;
        }

        this._paused = true;
        this._log('paused');
    }

    public togglePause(): void {
        if (this._paused) {
            this.unpause();
            return;
        }

        this.pause();
    }

    /**
     * Rebuild bar nodes from the template using the current inspector settings.
     * Safe to call at runtime (e.g. after changing barCount).
     */
    public rebuild(): void {
        this._clearBars();

        const template = this.barTemplate;
        const parent = this.container ?? this.node;
        if (!template || !template.isValid || !parent || !parent.isValid) {
            this._log('rebuild skipped: missing template or container');
            return;
        }

        const count = this._sanitizeBarCount(this.barCount);
        this.barCount = count;

        const minScale = this._sanitizePositive(this.minScaleY, 0.2);
        const maxScale = Math.max(minScale, this._sanitizePositive(this.maxScaleY, 1));
        const edgeMax = Math.min(
            maxScale,
            Math.max(minScale, this._sanitizePositive(this.edgeMaxScaleY, 0.45)),
        );
        const minFreq = this._sanitizePositive(this.minFrequency, 1.5);
        const maxFreq = Math.max(minFreq, this._sanitizePositive(this.maxFrequency, 5.5));
        const spacing = this._sanitizeNonNegative(this.barSpacing, 12);

        const baseScale = template.scale;
        const totalWidth = (count - 1) * spacing;
        const startX = -totalWidth * 0.5;

        for (let i = 0; i < count; i++) {
            const isEdge = i === 0 || i === count - 1;
            const barNode = instantiate(template);
            barNode.name = `VisualizerBar_${i}`;
            barNode.active = true;
            parent.addChild(barNode);
            barNode.setPosition(startX + i * spacing, 0, 0);
            barNode.setScale(baseScale.x, minScale, baseScale.z);

            if (this.forceBottomAnchor) {
                const ui = barNode.getComponent(UITransform);
                if (ui) {
                    ui.setAnchorPoint(ui.anchorX, 0);
                }
            }

            const barMax = isEdge ? edgeMax : this._randomRange(edgeMax, maxScale);
            const barMin = this._randomRange(minScale, Math.min(barMax, minScale + (barMax - minScale) * 0.35));

            this._bars.push({
                node: barNode,
                phase: Math.random() * Math.PI * 2,
                frequency: this._randomRange(minFreq, maxFreq),
                phase2: Math.random() * Math.PI * 2,
                frequency2: this._randomRange(minFreq * 0.35, maxFreq * 0.65),
                minScaleY: barMin,
                maxScaleY: barMax,
            });
        }

        if (this.hideTemplate && template !== parent) {
            template.active = false;
        }

        this._built = true;
        this._applyFrame(0);
        this._log('rebuilt bars:', count);
    }

    /** Apply one visualizer frame without advancing time when dt is 0. */
    private _applyFrame(dt: number): void {
        const bars = this._bars;
        if (bars.length === 0) {
            return;
        }

        const safeDt = dt > 0.05 ? 0.05 : Math.max(0, dt);
        const speed = this.speed > 0 ? this.speed : 0;
        const twoPi = Math.PI * 2;
        const scratch = this._scaleScratch;
        const advance = safeDt > 0 && speed > 0;

        for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            if (advance) {
                bar.phase += bar.frequency * speed * safeDt * twoPi;
                bar.phase2 += bar.frequency2 * speed * safeDt * twoPi;
            }

            const waveA = Math.sin(bar.phase);
            const waveB = Math.sin(bar.phase2);
            const mix = waveA * 0.7 + waveB * 0.3;
            const t = (mix + 1) * 0.5;
            const scaleY = bar.minScaleY + (bar.maxScaleY - bar.minScaleY) * t;

            const node = bar.node;
            const current = node.scale;
            scratch.set(current.x, scaleY, current.z);
            node.setScale(scratch);
        }
    }

    private _clearBars(): void {
        for (let i = 0; i < this._bars.length; i++) {
            const bar = this._bars[i];
            if (bar.node && bar.node.isValid) {
                bar.node.destroy();
            }
        }
        this._bars.length = 0;
        this._built = false;
    }

    private _sanitizeBarCount(value: number): number {
        if (!Number.isFinite(value)) {
            return 5;
        }

        let count = Math.floor(value);
        if (count < 5) {
            count = 5;
        }
        if ((count & 1) === 0) {
            count += 1;
        }
        return count;
    }

    private _sanitizePositive(value: number, fallback: number): number {
        if (!Number.isFinite(value) || value <= 0) {
            return fallback;
        }
        return value;
    }

    private _sanitizeNonNegative(value: number, fallback: number): number {
        if (!Number.isFinite(value) || value < 0) {
            return fallback;
        }
        return value;
    }

    private _randomRange(min: number, max: number): number {
        if (max <= min) {
            return min;
        }
        return min + Math.random() * (max - min);
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[FakeSoundVisualizer]', ...args);
    }
}
