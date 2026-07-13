import {
    _decorator,
    Component,
    Node,
    tween,
    Tween,
    Vec3,
    CCString,
} from 'cc';
import { ResponsiveUIScaler } from '../UI/ResponsiveUIScaler';

const { ccclass, property } = _decorator;

@ccclass('RelativeScalePulser')
export class RelativeScalePulser extends Component {
    @property({
        type: Node,
        tooltip: 'Optional target node. If empty, this component node is used.',
    })
    public targetNode: Node | null = null;

    @property({
        type: Vec3,
        tooltip: 'Relative scale multiplier applied during pulse.',
    })
    public pulseScale = new Vec3(1.15, 1.15, 1.15);

    @property({
        min: 1,
        tooltip: 'How many full pulses to play.',
    })
    public pulseCount = 1;

    @property({
        tooltip: 'Ignore pulseCount and keep pulsing until stopPulse() is called.',
    })
    public pulseInfinitely = false;

    @property({
        min: 0,
        tooltip: 'Duration in seconds for one full pulse (up + down).',
    })
    public durationPerPulse = 0.3;

    @property({
        type: CCString,
        tooltip: 'Tween easing name used for both half-steps.',
    })
    public easing = 'sineInOut';

    @property({
        tooltip: 'Automatically pulse when component starts.',
    })
    public autoPulseOnStart = false;

    @property({
        tooltip: 'If auto pulse is enabled, wait internally for completion.',
    })
    public autoWaitForCompletion = false;

    @property({
        tooltip: 'Capture target scale on load as the initial base scale.',
    })
    public captureBaseOnLoad = true;

    @property({
        tooltip: 'Recapture current target scale each time pulse() starts.',
    })
    public captureBaseEachPulse = true;

    @property({
        tooltip: 'Restore base scale when pulse is stopped/interrupted.',
    })
    public restoreScaleOnStop = true;

    @property
    public debugLogs = false;

    private readonly _baseScale = new Vec3(1, 1, 1);
    private _baseCaptured = false;
    private _activeTween: Tween<any> | null = null;
    private _activeResponsiveScaler: ResponsiveUIScaler | null = null;
    private readonly _runtimeMultiplierScratch = new Vec3(1, 1, 1);
    private _pendingResolver: (() => void) | null = null;
    private _runToken = 0;

    protected onLoad(): void {
        if (this.captureBaseOnLoad) {
            this.captureBaseScale();
        }
    }

    protected start(): void {
        if (!this.autoPulseOnStart) {
            return;
        }

        this.pulse(this.autoWaitForCompletion);
    }

    protected onDisable(): void {
        this.stopPulse(this.restoreScaleOnStop);
    }

    protected onDestroy(): void {
        this.stopPulse(this.restoreScaleOnStop);
    }

    public captureBaseScale(): void {
        const target = this._getTargetNode();
        if (!target) {
            return;
        }

        Vec3.copy(this._baseScale, target.scale);
        this._baseCaptured = true;
        this._log('Base scale captured:', this._baseScale);
    }

    public pulse(waitForCompletion = false): void | Promise<void> {
        return this.pulseWithConfig(
            undefined,
            undefined,
            waitForCompletion,
            undefined,
            undefined,
        );
    }

    /**
     * Scenario-friendly API:
     * args: [pulseCount?, durationPerPulse?, waitForCompletion?, scaleMultiplier?, easing?, pulseInfinitely?]
     */
    public pulseWithConfig(
        pulseCount?: number,
        durationPerPulse?: number,
        waitForCompletion = false,
        scaleMultiplier?: number[] | Vec3,
        easing?: string,
        pulseInfinitely?: boolean,
    ): void | Promise<void> {
        const target = this._getTargetNode();
        if (!target) {
            return waitForCompletion ? Promise.resolve() : undefined;
        }

        if (this.captureBaseEachPulse || !this._baseCaptured) {
            this.captureBaseScale();
        }

        const safeCount = this._sanitizeCount(pulseCount ?? this.pulseCount);
        const safeDurationPerPulse = this._sanitizeDuration(durationPerPulse ?? this.durationPerPulse);
        const safeEasing = this._sanitizeEasing(easing ?? this.easing);
        const safeMultiplier = this._resolveMultiplier(scaleMultiplier) ?? this.pulseScale;
        const safeInfinite = this._sanitizeInfinite(pulseInfinitely ?? this.pulseInfinitely);

        const runPromise = this._startPulse(
            target,
            safeCount,
            safeDurationPerPulse,
            safeMultiplier,
            safeEasing,
            safeInfinite,
        );

        if (waitForCompletion) {
            return runPromise;
        }

        void runPromise;
        return;
    }

    public stopPulse(restoreScale = true): void {
        this._runToken++;

        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        const activeScaler = this._activeResponsiveScaler;
        this._activeResponsiveScaler = null;

        if (activeScaler) {
            if (restoreScale) {
                activeScaler.resetRuntimeScaleMultiplier();
            }
            this._resolvePendingWaiter();
            return;
        }

        if (restoreScale) {
            const target = this._getTargetNode();
            if (target && this._baseCaptured) {
                target.setScale(this._baseScale);
            }
        }

        this._resolvePendingWaiter();
    }

    private _startPulse(
        target: Node,
        count: number,
        durationPerPulse: number,
        multiplier: Vec3,
        easing: string,
        pulseInfinitely: boolean,
    ): Promise<void> {
        this.stopPulse(false);
        const token = ++this._runToken;
        const responsiveScaler = target.getComponent(ResponsiveUIScaler);
        if (responsiveScaler) {
            return this._startPulseWithResponsiveScaler(
                responsiveScaler,
                count,
                durationPerPulse,
                multiplier,
                easing,
                pulseInfinitely,
                token,
            );
        }

        const halfDuration = Math.max(0.001, durationPerPulse * 0.5);
        const upScale = new Vec3(
            this._baseScale.x * multiplier.x,
            this._baseScale.y * multiplier.y,
            this._baseScale.z * multiplier.z,
        );

        return new Promise<void>((resolve) => {
            this._pendingResolver = resolve;
            target.setScale(this._baseScale);

            let sequence = tween(target);
            const singlePulse = tween(target)
                .to(halfDuration, { scale: upScale }, { easing })
                .to(halfDuration, { scale: this._baseScale }, { easing });

            if (pulseInfinitely) {
                this._activeTween = sequence.repeatForever(singlePulse).start();
                return;
            }

            for (let i = 0; i < count; i++) {
                sequence = sequence
                    .to(halfDuration, { scale: upScale }, { easing })
                    .to(halfDuration, { scale: this._baseScale }, { easing });
            }

            this._activeTween = sequence
                .call(() => {
                    if (token !== this._runToken) {
                        this._resolvePendingWaiter();
                        return;
                    }

                    target.setScale(this._baseScale);
                    this._activeTween = null;
                    this._resolvePendingWaiter();
                })
                .start();
        });
    }

    private _startPulseWithResponsiveScaler(
        responsiveScaler: ResponsiveUIScaler,
        count: number,
        durationPerPulse: number,
        multiplier: Vec3,
        easing: string,
        pulseInfinitely: boolean,
        token: number,
    ): Promise<void> {
        const halfDuration = Math.max(0.001, durationPerPulse * 0.5);
        const state = { x: 1, y: 1, z: 1 };
        const applyState = (): void => {
            this._runtimeMultiplierScratch.set(state.x, state.y, state.z);
            responsiveScaler.setRuntimeScaleMultiplier(this._runtimeMultiplierScratch);
        };

        return new Promise<void>((resolve) => {
            this._pendingResolver = resolve;
            this._activeResponsiveScaler = responsiveScaler;
            responsiveScaler.resetRuntimeScaleMultiplier();

            const singlePulse = tween(state)
                .to(
                    halfDuration,
                    { x: multiplier.x, y: multiplier.y, z: multiplier.z },
                    { easing, onUpdate: applyState },
                )
                .to(
                    halfDuration,
                    { x: 1, y: 1, z: 1 },
                    { easing, onUpdate: applyState },
                );

            let sequence = tween(state);

            if (pulseInfinitely) {
                this._activeTween = sequence.repeatForever(singlePulse).start();
                return;
            }

            for (let i = 0; i < count; i++) {
                sequence = sequence
                    .to(
                        halfDuration,
                        { x: multiplier.x, y: multiplier.y, z: multiplier.z },
                        { easing, onUpdate: applyState },
                    )
                    .to(
                        halfDuration,
                        { x: 1, y: 1, z: 1 },
                        { easing, onUpdate: applyState },
                    );
            }

            this._activeTween = sequence
                .call(() => {
                    if (token !== this._runToken) {
                        this._resolvePendingWaiter();
                        return;
                    }

                    responsiveScaler.resetRuntimeScaleMultiplier();
                    this._activeResponsiveScaler = null;
                    this._activeTween = null;
                    this._resolvePendingWaiter();
                })
                .start();
        });
    }

    private _getTargetNode(): Node | null {
        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            return null;
        }
        return target;
    }

    private _resolveMultiplier(value?: number[] | Vec3): Vec3 | null {
        if (!value) {
            return null;
        }

        if (value instanceof Vec3) {
            return new Vec3(value.x, value.y, value.z);
        }

        if (!Array.isArray(value) || value.length < 3) {
            return null;
        }

        const x = Number(value[0]);
        const y = Number(value[1]);
        const z = Number(value[2]);

        return new Vec3(
            Number.isFinite(x) ? x : 1,
            Number.isFinite(y) ? y : 1,
            Number.isFinite(z) ? z : 1,
        );
    }

    private _sanitizeCount(value: number): number {
        if (!Number.isFinite(value)) {
            return 1;
        }

        return Math.max(1, Math.floor(value));
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0.3;
        }

        return Math.max(0, value);
    }

    private _sanitizeEasing(value: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : 'linear';
    }

    private _sanitizeInfinite(value: boolean): boolean {
        return value === true;
    }

    private _resolvePendingWaiter(): void {
        if (!this._pendingResolver) {
            return;
        }

        const resolver = this._pendingResolver;
        this._pendingResolver = null;
        resolver();
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[RelativeScalePulser]', ...args);
    }
}
