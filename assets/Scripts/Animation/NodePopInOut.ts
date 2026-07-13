import {
    _decorator,
    CCString,
    Component,
    Node,
    tween,
    Tween,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('NodePopInOut')
export class NodePopInOut extends Component {
    @property({
        type: Node,
        tooltip: 'Optional target node to scale. If empty, this component node is used.',
    })
    public targetNode: Node | null = null;

    @property({
        type: Vec3,
        tooltip: 'Scale used when hidden/popped out.',
    })
    public hiddenScale = new Vec3(0, 0, 0);

    @property({
        min: 0,
        tooltip: 'Duration in seconds for popIn().',
    })
    public popInDuration = 0.25;

    @property({
        min: 0,
        tooltip: 'Duration in seconds for popOut().',
    })
    public popOutDuration = 0.2;

    @property({
        min: 0,
        tooltip: 'Delay in seconds used by popInThenOut().',
    })
    public holdDelay = 0.5;

    @property({
        type: CCString,
        tooltip: 'Tween easing name used by pop-in transitions.',
    })
    public popInEasing = 'backOut';

    @property({
        type: CCString,
        tooltip: 'Tween easing name used by pop-out transitions.',
    })
    public popOutEasing = 'backIn';

    @property({
        tooltip: 'Capture current target scale on load as the pop-in destination.',
    })
    public captureBaseOnLoad = true;

    @property({
        tooltip: 'Start the target at hidden scale when this component starts.',
    })
    public startHidden = false;

    @property({
        tooltip: 'Deactivate target node after pop-out finishes (optional).',
    })
    public deactivateWhenHidden = false;

    @property
    public debugLogs = false;

    private readonly _baseScale = new Vec3(1, 1, 1);
    private _baseCaptured = false;
    private _isPoppedIn = false;
    private _activeTween: Tween<Node> | null = null;
    private _runToken = 0;
    private _pendingResolver: (() => void) | null = null;

    protected onLoad(): void {
        if (this.captureBaseOnLoad) {
            this.captureBaseScale();
        }
    }

    protected start(): void {
        if (!this.startHidden) {
            return;
        }

        const target = this._getTargetNode();
        if (!target) {
            return;
        }

        target.setScale(this.hiddenScale);
        this._isPoppedIn = false;
        if (this.deactivateWhenHidden) {
            target.active = false;
        }
    }

    protected onDisable(): void {
        this.stopPop(true);
    }

    protected onDestroy(): void {
        this.stopPop(true);
    }

    public captureBaseScale(): void {
        const target = this._getTargetNode();
        if (!target) {
            return;
        }

        Vec3.copy(this._baseScale, target.scale);
        this._baseCaptured = true;
        this._isPoppedIn = true;
        this._log('Captured base scale:', this._baseScale);
    }

    public popIn(
        waitForCompletion = false,
        duration?: number,
        easing?: string,
    ): void | Promise<void> {
        if (!this._ensureBaseCaptured()) {
            return waitForCompletion ? Promise.resolve() : undefined;
        }

        return this._runSingleTransition(
            this._baseScale,
            this._resolveDuration(duration, this.popInDuration),
            this._sanitizeEasing(easing ?? this.popInEasing),
            waitForCompletion,
            true,
            true,
        );
    }

    public popOut(
        waitForCompletion = false,
        duration?: number,
        easing?: string,
    ): void | Promise<void> {
        return this._runSingleTransition(
            this.hiddenScale,
            this._resolveDuration(duration, this.popOutDuration),
            this._sanitizeEasing(easing ?? this.popOutEasing),
            waitForCompletion,
            false,
            false,
        );
    }

    public toggle(
        waitForCompletion = false,
        popInDuration?: number,
        popOutDuration?: number,
        popInEasing?: string,
        popOutEasing?: string,
    ): void | Promise<void> {
        if (this._isPoppedIn) {
            return this.popOut(waitForCompletion, popOutDuration, popOutEasing);
        }
        return this.popIn(waitForCompletion, popInDuration, popInEasing);
    }

    public popInThenOut(
        waitForCompletion = false,
        popInDuration?: number,
        delay?: number,
        popOutDuration?: number,
        popInEasing?: string,
        popOutEasing?: string,
    ): void | Promise<void> {
        if (!this._ensureBaseCaptured()) {
            return waitForCompletion ? Promise.resolve() : undefined;
        }

        const target = this._getTargetNode();
        if (!target) {
            return waitForCompletion ? Promise.resolve() : undefined;
        }

        this.stopPop(true);
        const token = ++this._runToken;
        const safePopInDuration = this._resolveDuration(
            popInDuration,
            this.popInDuration,
        );
        const safeDelay = this._resolveDuration(delay, this.holdDelay);
        const safePopOutDuration = this._resolveDuration(
            popOutDuration,
            this.popOutDuration,
        );
        const safePopInEasing = this._sanitizeEasing(
            popInEasing ?? this.popInEasing,
        );
        const safePopOutEasing = this._sanitizeEasing(
            popOutEasing ?? this.popOutEasing,
        );

        const runPromise = new Promise<void>((resolve) => {
            this._pendingResolver = resolve;
            target.active = true;
            target.setScale(this.hiddenScale);

            let sequence = tween(target);

            if (safePopInDuration > 0) {
                sequence = sequence.to(
                    safePopInDuration,
                    { scale: this._baseScale },
                    { easing: safePopInEasing },
                );
            } else {
                sequence = sequence.call(() => {
                    target.setScale(this._baseScale);
                });
            }

            sequence = sequence.call(() => {
                this._isPoppedIn = true;
            });

            if (safeDelay > 0) {
                sequence = sequence.delay(safeDelay);
            }

            if (safePopOutDuration > 0) {
                sequence = sequence.to(
                    safePopOutDuration,
                    { scale: this.hiddenScale },
                    { easing: safePopOutEasing },
                );
            } else {
                sequence = sequence.call(() => {
                    target.setScale(this.hiddenScale);
                });
            }

            this._activeTween = sequence
                .call(() => {
                    if (token !== this._runToken) {
                        this._resolvePendingWaiter();
                        return;
                    }

                    this._activeTween = null;
                    this._isPoppedIn = false;

                    if (this.deactivateWhenHidden) {
                        target.active = false;
                    }

                    this._resolvePendingWaiter();
                })
                .start();
        });

        if (waitForCompletion) {
            return runPromise;
        }

        void runPromise;
        return;
    }

    public snapIn(): void {
        void this.popIn(false, 0);
    }

    public snapOut(): void {
        void this.popOut(false, 0);
    }

    public stopPop(completeCurrentWaiter = true): void {
        this._runToken++;

        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        if (completeCurrentWaiter) {
            this._resolvePendingWaiter();
        }
    }

    private _runSingleTransition(
        destination: Vec3,
        duration: number,
        easing: string,
        waitForCompletion: boolean,
        markPoppedIn: boolean,
        ensureTargetActive: boolean,
    ): void | Promise<void> {
        const target = this._getTargetNode();
        if (!target) {
            return waitForCompletion ? Promise.resolve() : undefined;
        }

        this.stopPop(true);
        const token = ++this._runToken;
        const safeDuration = this._sanitizeDuration(duration);
        const targetScale = new Vec3(destination.x, destination.y, destination.z);

        const runPromise = new Promise<void>((resolve) => {
            this._pendingResolver = resolve;

            if (ensureTargetActive) {
                target.active = true;
            }

            if (safeDuration <= 0) {
                target.setScale(targetScale);
                this._activeTween = null;
                this._isPoppedIn = markPoppedIn;

                if (!markPoppedIn && this.deactivateWhenHidden) {
                    target.active = false;
                }

                this._resolvePendingWaiter();
                return;
            }

            this._activeTween = tween(target)
                .to(safeDuration, { scale: targetScale }, { easing })
                .call(() => {
                    if (token !== this._runToken) {
                        this._resolvePendingWaiter();
                        return;
                    }

                    this._activeTween = null;
                    this._isPoppedIn = markPoppedIn;

                    if (!markPoppedIn && this.deactivateWhenHidden) {
                        target.active = false;
                    }

                    this._resolvePendingWaiter();
                })
                .start();
        });

        if (waitForCompletion) {
            return runPromise;
        }

        void runPromise;
        return;
    }

    private _getTargetNode(): Node | null {
        const target = this.targetNode ?? this.node;
        if (!target || !target.isValid) {
            return null;
        }
        return target;
    }

    private _ensureBaseCaptured(): boolean {
        if (this._baseCaptured) {
            return true;
        }

        this.captureBaseScale();
        return this._baseCaptured;
    }

    private _resolveDuration(
        value: number | undefined,
        fallback: number,
    ): number {
        if (value === undefined || value === null || !Number.isFinite(value)) {
            return fallback;
        }
        return value;
    }

    private _sanitizeDuration(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, value);
    }

    private _sanitizeEasing(value: string): string {
        const normalized = value?.trim();
        return normalized ? normalized : 'linear';
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
        console.log('[NodePopInOut]', ...args);
    }
}
