import {
    _decorator,
    AudioSource,
    CCString,
    Component,
    director,
    EventTarget,
    find,
    JsonAsset,
    Node,
    Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

type ScenarioMode = 'sequence' | 'parallel';
type ScenarioNextMode = 'auto' | 'wait';
type ScenarioTarget = string | number | Node | null | undefined;

export interface ScenarioAction {
    type: string;
    target?: ScenarioTarget;

    // Common action fields.
    value?: boolean;
    duration?: number;
    easing?: string;
    to?: number[];
    event?: string;
    data?: unknown;

    // Nested sequence / parallel actions.
    actions?: ScenarioAction[];

    // Component call action.
    component?: string;
    script?: string; // Legacy alias kept for easier PlayCanvas JSON conversion.
    method?: string;
    args?: unknown[];

    // Audio action.
    index?: number;
}

export interface ScenarioStep {
    id?: string;
    mode?: ScenarioMode;
    next?: ScenarioNextMode;
    actions?: ScenarioAction[];
}

export type ScenarioActionHandler = (
    action: ScenarioAction,
    token: number,
) => unknown | Promise<unknown>;

interface ScenarioJob {
    token: number;
    tick: (dt: number) => boolean;
    resolve: () => void;
}

interface ScenarioEventWaiter {
    token: number;
    resolve: () => void;
    dispose: () => void;
}

@ccclass('ScenarioManager')
export class ScenarioManager extends Component {
    /**
     * Global event bus replacing PlayCanvas app.fire/app.on.
     *
     * Examples:
     * ScenarioManager.events.emit(ScenarioManager.Event.NEXT);
     * ScenarioManager.events.emit(ScenarioManager.Event.GOTO, 'showCTA');
     */
    public static readonly events = new EventTarget();

    public static readonly Event = {
        START: 'scenario:start',
        NEXT: 'scenario:next',
        GOTO: 'scenario:goto',
        RESTART: 'scenario:restart',
        STOP: 'scenario:stop',
        FINISHED: 'scenario:finished',
    } as const;

    @property({
        tooltip: 'Start the scenario automatically when this component starts.',
    })
    public autoStart = true;

    @property({
        min: 0,
        tooltip: 'Delay in seconds before automatic startup.',
    })
    public startDelay = 0;

    @property({
        tooltip: 'Print scenario execution details to the console.',
    })
    public debugLogs = false;

    @property({
        tooltip: 'Stop the current scenario if an action throws or rejects.',
    })
    public stopOnActionError = true;

    /**
     * entityKeys and entityRefs use matching indexes.
     *
     * Example:
     * entityKeys[0] = "train"
     * entityRefs[0] = Train node
     */
    @property({
        type: [CCString],
        tooltip: 'Keys used by scenario action targets. Must match entityRefs indexes.',
    })
    public entityKeys: string[] = [];

    @property({
        type: [Node],
        tooltip: 'Node references matching entityKeys indexes.',
    })
    public entityRefs: Node[] = [];

    @property({
        multiline: true,
        tooltip: 'Optional JSON scenario. Leave empty to use buildScenario().',
    })
    public stepsJson = '';

    @property({
        type: JsonAsset,
        tooltip: 'Optional JSON scenario asset. Used when stepsJson is empty.',
    })
    public stepsAsset: JsonAsset | null = null;

    public get currentStepIndex(): number {
        return this._index;
    }

    public get isRunning(): boolean {
        return this._running;
    }

    public get isWaitingForNext(): boolean {
        return this._waitingForNext;
    }

    private _index = -1;
    private _steps: ScenarioStep[] = [];
    private _running = false;
    private _waitingForNext = false;
    private _pendingNext = false;
    private _token = 0;

    private _nextResolver: (() => void) | null = null;
    private readonly _jobs: ScenarioJob[] = [];
    private readonly _eventWaiters: ScenarioEventWaiter[] = [];
    private readonly _refMap = new Map<string, Node>();
    private readonly _actionHandlers = new Map<string, ScenarioActionHandler>();

    protected onLoad(): void {
        this._buildRefMap();
        this._installDefaultActions();
        this._steps = this._loadSteps();

        ScenarioManager.events.on(ScenarioManager.Event.START, this.startScenario, this);
        ScenarioManager.events.on(ScenarioManager.Event.NEXT, this.nextScenario, this);
        ScenarioManager.events.on(ScenarioManager.Event.GOTO, this.gotoStep, this);
        ScenarioManager.events.on(ScenarioManager.Event.RESTART, this.restartScenario, this);
        ScenarioManager.events.on(ScenarioManager.Event.STOP, this.stopScenario, this);
    }

    /** Cocos lifecycle callback. Use startScenario() to start it manually. */
    protected start(): void {
        if (!this.autoStart) {
            return;
        }

        if (this.startDelay <= 0) {
            this.startScenario();
            return;
        }

        const token = this._token;
        void this._wait(this.startDelay, token).then(() => {
            if (token === this._token && this.isValid) {
                this.startScenario();
            }
        });
    }

    protected update(dt: number): void {
        for (let i = this._jobs.length - 1; i >= 0; i--) {
            const job = this._jobs[i];
            const cancelled = job.token !== this._token;
            const finished = cancelled || job.tick(dt);

            if (!finished) {
                continue;
            }

            this._jobs.splice(i, 1);
            job.resolve();
        }
    }

    protected onDestroy(): void {
        ScenarioManager.events.off(ScenarioManager.Event.START, this.startScenario, this);
        ScenarioManager.events.off(ScenarioManager.Event.NEXT, this.nextScenario, this);
        ScenarioManager.events.off(ScenarioManager.Event.GOTO, this.gotoStep, this);
        ScenarioManager.events.off(ScenarioManager.Event.RESTART, this.restartScenario, this);
        ScenarioManager.events.off(ScenarioManager.Event.STOP, this.stopScenario, this);

        this._invalidateCurrentRun();
        this._actionHandlers.clear();
        this._refMap.clear();
    }

    /** Starts from the first step. Safe to call from another component. */
    public startScenario(): void {
        this._invalidateCurrentRun();

        this._index = -1;
        this._running = false;
        this._waitingForNext = false;
        this._pendingNext = false;

        this.nextScenario();
    }

    public restartScenario(): void {
        this.startScenario();
    }

    /** Stops the scenario and resolves/cancels all active waits and tweens. */
    public stopScenario(): void {
        this._invalidateCurrentRun();
        this._running = false;
        this._waitingForNext = false;
        this._pendingNext = false;
        this._log('Scenario stopped.');
    }

    /**
     * Continues after a step whose next mode is "wait", or advances normally.
     * This can be connected directly to a Cocos Button click event.
     */
    public nextScenario(): void {
        if (this._nextResolver) {
            const resolver = this._nextResolver;
            this._nextResolver = null;
            this._waitingForNext = false;
            resolver();
            return;
        }

        if (this._running) {
            const currentStep = this._steps[this._index];

            if (currentStep?.next === 'wait') {
                this._log('Ignoring next while a wait step is still running.');
                return;
            }

            this._pendingNext = true;
            return;
        }

        this._waitingForNext = false;
        this._index++;

        if (this._index >= this._steps.length) {
            this._log('Scenario finished.');
            ScenarioManager.events.emit(ScenarioManager.Event.FINISHED, this);
            this.node.emit(ScenarioManager.Event.FINISHED, this);
            return;
        }

        void this._runStep(this._steps[this._index]);
    }

    /** Jumps to a step by id or zero-based index. */
    public gotoStep(idOrIndex: string | number): void {
        let targetIndex = -1;

        if (typeof idOrIndex === 'number') {
            targetIndex = idOrIndex;
        } else {
            targetIndex = this._steps.findIndex((step) => step.id === idOrIndex);
        }

        if (targetIndex < 0 || targetIndex >= this._steps.length) {
            console.warn('[ScenarioManager] Step not found:', idOrIndex);
            return;
        }

        this._invalidateCurrentRun();
        this._running = false;
        this._waitingForNext = false;
        this._pendingNext = false;
        this._index = targetIndex - 1;
        this.nextScenario();
    }

    /** Replaces the scenario at runtime. */
    public setSteps(steps: ScenarioStep[], restartNow = false): void {
        this._steps = steps ?? [];

        if (restartNow) {
            this.startScenario();
        }
    }

    /** Rebuilds entityKeys/entityRefs after changing them at runtime. */
    public rebuildReferenceMap(): void {
        this._buildRefMap();
    }

    /** Registers or overrides an action type. */
    public registerAction(type: string, handler: ScenarioActionHandler): void {
        if (!type || !handler) {
            return;
        }

        this._actionHandlers.set(type, handler);
    }

    /** Removes a custom action handler. */
    public unregisterAction(type: string): void {
        this._actionHandlers.delete(type);
    }

    /**
     * Edit this method for a code-defined scenario, or populate stepsJson instead.
     */
    public buildScenario(): ScenarioStep[] {
        return [
            {
                id: 'setup',
                mode: 'parallel',
                next: 'auto',
                actions: [
                    { type: 'enable', target: 'tapHint', value: false },
                    { type: 'enable', target: 'ctaButton', value: false },
                    { type: 'enable', target: 'train', value: true },
                ],
            },
            {
                id: 'introMove',
                mode: 'sequence',
                next: 'auto',
                actions: [
                    {
                        type: 'localMoveTo',
                        target: 'cameraTarget',
                        to: [0, 1.5, 0],
                        duration: 0.5,
                        easing: 'outQuad',
                    },
                    { type: 'wait', duration: 0.2 },
                    { type: 'enable', target: 'tapHint', value: true },
                    {
                        type: 'scaleTo',
                        target: 'tapHint',
                        to: [1.15, 1.15, 1.15],
                        duration: 0.18,
                        easing: 'outBack',
                    },
                    {
                        type: 'scaleTo',
                        target: 'tapHint',
                        to: [1, 1, 1],
                        duration: 0.12,
                        easing: 'outQuad',
                    },
                ],
            },
            {
                id: 'waitForUserTap',
                mode: 'sequence',
                next: 'wait',
                actions: [{ type: 'fire', event: 'hint:showTap' }],
            },
            {
                id: 'afterUserTap',
                mode: 'parallel',
                next: 'auto',
                actions: [
                    { type: 'enable', target: 'tapHint', value: false },
                    {
                        type: 'call',
                        target: 'train',
                        component: 'TrainController',
                        method: 'moveToPathPointOneBased',
                        args: [3],
                    },
                ],
            },
            {
                id: 'showCTA',
                mode: 'sequence',
                next: 'wait',
                actions: [
                    { type: 'wait', duration: 0.3 },
                    { type: 'enable', target: 'ctaButton', value: true },
                    {
                        type: 'scaleTo',
                        target: 'ctaButton',
                        to: [1.2, 1.2, 1.2],
                        duration: 0.2,
                        easing: 'outBack',
                    },
                    {
                        type: 'scaleTo',
                        target: 'ctaButton',
                        to: [1, 1, 1],
                        duration: 0.15,
                        easing: 'outQuad',
                    },
                ],
            },
        ];
    }

    private _buildRefMap(): void {
        this._refMap.clear();

        const count = Math.min(this.entityKeys.length, this.entityRefs.length);

        for (let i = 0; i < count; i++) {
            const key = this.entityKeys[i]?.trim();
            const node = this.entityRefs[i];

            if (key && node) {
                this._refMap.set(key, node);
            }
        }
    }

    private _loadSteps(): ScenarioStep[] {
        if (this.stepsJson.trim().length > 2) {
            try {
                const parsed = JSON.parse(this.stepsJson) as unknown;

                if (Array.isArray(parsed)) {
                    return parsed as ScenarioStep[];
                }

                console.warn('[ScenarioManager] stepsJson must contain a JSON array.');
            } catch (error) {
                console.warn(
                    '[ScenarioManager] Invalid stepsJson. Falling back to buildScenario().',
                    error,
                );
            }
        }

        if (this.stepsAsset?.json) {
            const assetData = this.stepsAsset.json;

            if (Array.isArray(assetData)) {
                return assetData as ScenarioStep[];
            }

            console.warn('[ScenarioManager] stepsAsset must contain a JSON array.');
        }

        return this.buildScenario();
    }

    private async _runStep(step: ScenarioStep): Promise<void> {
        const token = this._token;

        this._running = true;
        this._pendingNext = false;
        this._log('Running step:', step.id ?? this._index);

        try {
            await this._runActionGroup(step.actions ?? [], step.mode ?? 'sequence', token);
        } catch (error) {
            if (token !== this._token) {
                return;
            }

            console.error(
                `[ScenarioManager] Step failed: ${step.id ?? this._index}`,
                error,
            );

            this._running = false;

            if (this.stopOnActionError) {
                this.stopScenario();
                return;
            }
        }

        if (token !== this._token) {
            return;
        }

        this._running = false;

        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:_runStep',message:'step finished',data:{stepId:step.id,stepIndex:this._index,next:step.next??'auto',pendingNext:this._pendingNext},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        if (this._pendingNext) {
            this._pendingNext = false;
            this.nextScenario();
            return;
        }

        if (step.next === 'wait') {
            this._waitingForNext = true;
            this._log('Waiting for nextScenario().');
            return;
        }

        this.nextScenario();
    }

    private async _runActionGroup(
        actions: ScenarioAction[],
        mode: ScenarioMode,
        token: number,
    ): Promise<void> {
        if (token !== this._token) {
            return;
        }

        if (mode === 'parallel') {
            await Promise.all(actions.map((action) => this._runAction(action, token)));
            return;
        }

        for (const action of actions) {
            if (token !== this._token) {
                return;
            }

            await this._runAction(action, token);
        }
    }

    private async _runAction(action: ScenarioAction, token: number): Promise<void> {
        if (!action || token !== this._token) {
            return;
        }

        if (action.type === 'sequence' || action.type === 'parallel') {
            await this._runActionGroup(
                action.actions ?? [],
                action.type as ScenarioMode,
                token,
            );
            return;
        }

        const handler = this._actionHandlers.get(action.type);

        if (!handler) {
            console.warn('[ScenarioManager] Unknown action type:', action.type);
            return;
        }

        await handler(action, token);
    }

    private _installDefaultActions(): void {
        this.registerAction('enable', (action) => {
            const target = this._getNode(action.target);

            if (target) {
                target.active = action.value !== false;
            }
        });

        this.registerAction('wait', (action, token) => {
            return this._wait(action.duration ?? 0, token);
        });

        this.registerAction('waitNext', (_action, token) => {
            return this._waitForNext(token);
        });

        this.registerAction('waitEvent', (action, token) => {
            return this._waitForEvent(action, token);
        });

        this.registerAction('localMoveTo', (action, token) => {
            const target = this._getNode(action.target);

            return this._tweenVec3(
                target,
                () => this._copyVec3(target?.position),
                (value) => target?.setPosition(value),
                action.to,
                action.duration,
                action.easing,
                token,
            );
        });

        this.registerAction('moveTo', (action, token) => {
            const target = this._getNode(action.target);

            return this._tweenVec3(
                target,
                () => this._copyVec3(target?.worldPosition),
                (value) => target?.setWorldPosition(value),
                action.to,
                action.duration,
                action.easing,
                token,
            );
        });

        this.registerAction('localRotateTo', (action, token) => {
            const target = this._getNode(action.target);

            return this._tweenVec3(
                target,
                () => this._copyVec3(target?.eulerAngles),
                (value) => target?.setRotationFromEuler(value.x, value.y, value.z),
                action.to,
                action.duration,
                action.easing,
                token,
            );
        });

        this.registerAction('scaleTo', (action, token) => {
            const target = this._getNode(action.target);

            return this._tweenVec3(
                target,
                () => this._copyVec3(target?.scale),
                (value) => target?.setScale(value),
                action.to,
                action.duration,
                action.easing,
                token,
            );
        });

        this.registerAction('setPosition', (action) => {
            const target = this._getNode(action.target);
            const value = this._arrayToVec3(action.to);

            if (target && value) {
                target.setWorldPosition(value);
            }
        });

        this.registerAction('setLocalPosition', (action) => {
            const target = this._getNode(action.target);
            const value = this._arrayToVec3(action.to);

            if (target && value) {
                target.setPosition(value);
            }
        });

        this.registerAction('setLocalRotation', (action) => {
            const target = this._getNode(action.target);
            const value = this._arrayToVec3(action.to);

            if (target && value) {
                target.setRotationFromEuler(value.x, value.y, value.z);
            }
        });

        this.registerAction('setLocalScale', (action) => {
            const target = this._getNode(action.target);
            const value = this._arrayToVec3(action.to);

            if (target && value) {
                target.setScale(value);
            }
        });

        this.registerAction('fire', (action) => {
            if (!action.event) {
                return;
            }

            const target = action.target !== undefined
                ? this._getNode(action.target)
                : null;

            if (target) {
                target.emit(action.event, action.data);
            } else {
                ScenarioManager.events.emit(action.event, action.data);
            }
        });

        this.registerAction('call', (action) => {
            const target = this._getNode(action.target);
            const componentName = action.component ?? action.script;

            if (!target || !componentName || !action.method) {
                // #region agent log
                fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:call',message:'call action failed',data:{targetKey:action.target,hasNode:!!target,componentName,method:action.method},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                console.warn(
                    '[ScenarioManager] call requires target, component, and method.',
                    action,
                );
                return;
            }

            const component = target.getComponent(componentName);

            if (!component) {
                // #region agent log
                fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:call',message:'component not found',data:{targetKey:action.target,nodeName:target.name,componentName,method:action.method},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                console.warn(
                    `[ScenarioManager] Component not found: ${componentName} on ${target.name}`,
                );
                return;
            }

            const componentRecord = component as unknown as Record<string, unknown>;
            const method = componentRecord[action.method];

            if (typeof method !== 'function') {
                console.warn(
                    `[ScenarioManager] Method not found: ${componentName}.${action.method}`,
                );
                return;
            }

            const args = this._resolveArgs(action.args ?? []);

            this._log('Calling component method:', {
                target: action.target,
                node: target.name,
                component: componentName,
                method: action.method,
                args,
            });

            // #region agent log
            fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:call',message:'call action invoking',data:{targetKey:action.target,nodeName:target.name,componentName,method:action.method},timestamp:Date.now(),hypothesisId:'F',runId:'post-fix'})}).catch(()=>{});
            // #endregion

            return (method as (...methodArgs: unknown[]) => unknown).apply(component, args);
        });

        this.registerAction('playSound', (action) => {
            const target = this._getNode(action.target);
            const sources = target?.getComponents(AudioSource) ?? [];
            const source = sources[action.index ?? 0];

            if (!source) {
                console.warn('[ScenarioManager] AudioSource not found:', action.target);
                return;
            }

            source.play();
        });

        this.registerAction('stopSound', (action) => {
            const target = this._getNode(action.target);
            const sources = target?.getComponents(AudioSource) ?? [];
            const source = sources[action.index ?? 0];

            if (!source) {
                console.warn('[ScenarioManager] AudioSource not found:', action.target);
                return;
            }

            source.stop();
        });
    }

    private _getNode(target: ScenarioTarget): Node | null {
        if (target === undefined || target === null || target === '') {
            return null;
        }

        if (target instanceof Node) {
            return target;
        }

        if (typeof target === 'number') {
            return this.entityRefs[target] ?? null;
        }

        const mapped = this._refMap.get(target);

        if (mapped) {
            return mapped;
        }

        const numericIndex = Number.parseInt(target, 10);

        if (Number.isInteger(numericIndex) && String(numericIndex) === target.trim()) {
            const indexedNode = this.entityRefs[numericIndex];

            if (indexedNode) {
                return indexedNode;
            }
        }

        const scene = director.getScene();

        if (!scene) {
            return null;
        }

        // Supports hierarchy paths such as "Canvas/HUD/CTAButton".
        const foundByPath = find(target, scene);

        if (foundByPath) {
            return foundByPath;
        }

        // Final fallback: recursively search by node name.
        return this._findNodeByName(scene, target);
    }

    private _findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) {
            return root;
        }

        for (const child of root.children) {
            const found = this._findNodeByName(child, name);

            if (found) {
                return found;
            }
        }

        return null;
    }

    private _resolveArgs(args: unknown[]): unknown[] {
        return args.map((arg) => this._resolveArg(arg));
    }

    private _resolveArg(arg: unknown): unknown {
        if (arg === null || arg === undefined) {
            return arg;
        }

        if (Array.isArray(arg)) {
            return arg.map((entry) => this._resolveArg(entry));
        }

        if (typeof arg !== 'object') {
            return arg;
        }

        const source = arg as Record<string, unknown>;
        const nodeTarget = source.$node ?? source.$entity;

        if (nodeTarget !== undefined) {
            return this._getNode(nodeTarget as ScenarioTarget);
        }

        const resolved: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(source)) {
            resolved[key] = this._resolveArg(value);
        }

        return resolved;
    }

    private _wait(duration: number, token: number): Promise<void> {
        const safeDuration = Math.max(0, duration || 0);

        if (safeDuration <= 0 || token !== this._token) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            let elapsed = 0;

            this._jobs.push({
                token,
                resolve,
                tick: (dt) => {
                    elapsed += dt;
                    return elapsed >= safeDuration;
                },
            });
        });
    }

    private _waitForNext(token: number): Promise<void> {
        if (token !== this._token) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            this._waitingForNext = true;
            this._nextResolver = () => {
                this._waitingForNext = false;
                resolve();
            };
        });
    }

    private _waitForEvent(action: ScenarioAction, token: number): Promise<void> {
        if (token !== this._token) {
            return Promise.resolve();
        }

        const eventName = action.event?.trim() ?? '';
        if (!eventName) {
            console.warn('[ScenarioManager] waitEvent requires a non-empty event field.');
            return Promise.resolve();
        }

        const targetNode = action.target !== undefined
            ? this._getNode(action.target)
            : null;

        return new Promise<void>((resolve) => {
            let settled = false;

            const complete = (): void => {
                if (settled) {
                    return;
                }

                settled = true;
                remove();
                resolve();
            };

            const handler = (): void => {
                // #region agent log
                fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:_waitForEvent',message:'waitEvent received',data:{eventName,stepIndex:this._index},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                complete();
            };

            const remove = (): void => {
                if (targetNode) {
                    targetNode.off(eventName, handler, this);
                } else {
                    ScenarioManager.events.off(eventName, handler, this);
                }

                const index = this._eventWaiters.findIndex((waiter) => waiter.resolve === complete);
                if (index >= 0) {
                    this._eventWaiters.splice(index, 1);
                }
            };

            if (targetNode) {
                targetNode.on(eventName, handler, this);
            } else {
                ScenarioManager.events.on(eventName, handler, this);
            }

            // #region agent log
            fetch('http://127.0.0.1:7461/ingest/01b24ac0-959e-429e-a45d-4703a760022c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8df5f5'},body:JSON.stringify({sessionId:'8df5f5',location:'ScenarioManager.ts:_waitForEvent',message:'waitEvent registered',data:{eventName,stepIndex:this._index,onNode:!!targetNode},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
            // #endregion

            this._eventWaiters.push({
                token,
                resolve: complete,
                dispose: remove,
            });
        });
    }

    private _tweenVec3(
        target: Node | null,
        getter: () => Vec3,
        setter: (value: Vec3) => void,
        toArray: number[] | undefined,
        duration: number | undefined,
        easing: string | undefined,
        token: number,
    ): Promise<void> {
        const to = this._arrayToVec3(toArray);

        if (!target || !to || token !== this._token) {
            return Promise.resolve();
        }

        const safeDuration = Math.max(0, duration ?? 0);
        const from = getter();

        if (safeDuration <= 0) {
            setter(to);
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            let elapsed = 0;
            const current = new Vec3();

            this._jobs.push({
                token,
                resolve,
                tick: (dt) => {
                    elapsed += dt;

                    const t = Math.min(1, elapsed / safeDuration);
                    const eased = this._ease(t, easing);

                    current.set(
                        from.x + (to.x - from.x) * eased,
                        from.y + (to.y - from.y) * eased,
                        from.z + (to.z - from.z) * eased,
                    );
                    setter(current);

                    return t >= 1;
                },
            });
        });
    }

    private _arrayToVec3(value: number[] | undefined): Vec3 | null {
        if (!value || value.length < 3) {
            return null;
        }

        return new Vec3(
            Number(value[0]) || 0,
            Number(value[1]) || 0,
            Number(value[2]) || 0,
        );
    }

    private _copyVec3(value: Readonly<Vec3> | undefined): Vec3 {
        if (!value) {
            return new Vec3();
        }

        return new Vec3(value.x, value.y, value.z);
    }

    private _invalidateCurrentRun(): void {
        this._token++;

        if (this._nextResolver) {
            const resolver = this._nextResolver;
            this._nextResolver = null;
            resolver();
        }

        for (const job of this._jobs) {
            job.resolve();
        }

        this._jobs.length = 0;

        for (const waiter of this._eventWaiters.splice(0)) {
            waiter.resolve();
        }
    }

    private _ease(t: number, easing?: string): number {
        switch (easing) {
            case 'inQuad':
                return t * t;

            case 'outQuad':
                return t * (2 - t);

            case 'inOutQuad':
                return t < 0.5
                    ? 2 * t * t
                    : -1 + (4 - 2 * t) * t;

            case 'outBack': {
                const c1 = 1.70158;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
            }

            case 'linear':
            default:
                return t;
        }
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }

        console.log('[ScenarioManager]', ...args);
    }
}
