import { _decorator, CCString, Component } from 'cc';
import { ScenarioManager } from '../Presentation/ScenarioManager_Cocos388';

const { ccclass, property } = _decorator;

type EventToken = string | number | number[];
type RelayChannel = 'local' | 'app';

interface ResolvedEvent {
    eventName: string;
    eventIndex: number;
}

@ccclass('EventTriggerRelay')
export class EventTriggerRelay extends Component {
    @property({
        type: [CCString],
        tooltip: 'Local node event names. Triggered with node.emit(eventName, payload).',
    })
    public localEvents: string[] = [];

    @property({
        type: [CCString],
        tooltip: 'App-wide event names. Triggered with ScenarioManager.events.emit(eventName, payload).',
    })
    public appEvents: string[] = [];

    @property({
        type: [CCString],
        tooltip: 'Per-local-event JSON payloads by index. Empty means no custom payload.',
    })
    public localEventPayloadsJson: string[] = [];

    @property({
        type: [CCString],
        tooltip: 'Per-app-event JSON payloads by index. Empty means no custom payload.',
    })
    public appEventPayloadsJson: string[] = [];

    @property
    public debugLogs = false;

    @property({
        tooltip: 'Use Inspector JSON payload when trigger methods are called without payload.',
    })
    public useInspectorPayload = false;

    @property({
        type: CCString,
        tooltip: 'Optional JSON payload used when caller payload is omitted. Example: {"key":"value","amount":1}',
    })
    public inspectorPayloadJson = '';

    private _cachedInspectorPayloadJson = '';
    private _cachedInspectorPayload: unknown = undefined;
    private _hasCachedInspectorPayload = false;
    private _isCachedInspectorPayloadValid = false;
    private _eventPayloadCache = new Map<string, { raw: string; valid: boolean; value: unknown }>();

    public triggerLocal(eventNameOrIndex: EventToken, payload?: unknown): boolean {
        return this._triggerByToken(
            'local',
            this.localEvents,
            eventNameOrIndex,
            payload,
            (eventName, resolvedPayload) => {
                this.node.emit(eventName, resolvedPayload);
            }
        );
    }

    public triggerApp(eventNameOrIndex: EventToken, payload?: unknown): boolean {
        return this._triggerByToken(
            'app',
            this.appEvents,
            eventNameOrIndex,
            payload,
            (eventName, resolvedPayload) => {
                ScenarioManager.events.emit(eventName, resolvedPayload);
            }
        );
    }

    public triggerBoth(eventNameOrIndex: EventToken, payload?: unknown): boolean {
        const localTriggered = this.triggerLocal(eventNameOrIndex, payload);
        const appTriggered = this.triggerApp(eventNameOrIndex, payload);
        return localTriggered || appTriggered;
    }

    public triggerAllLocal(payload?: unknown): boolean {
        return this._triggerAllEvents(this.localEvents, (eventName, eventIndex) => {
            const resolvedPayload = this._resolvePayload('local', eventIndex, payload);
            this.node.emit(eventName, resolvedPayload);
            this._log('local', eventName, resolvedPayload);
        });
    }

    public triggerAllApp(payload?: unknown): boolean {
        return this._triggerAllEvents(this.appEvents, (eventName, eventIndex) => {
            const resolvedPayload = this._resolvePayload('app', eventIndex, payload);
            ScenarioManager.events.emit(eventName, resolvedPayload);
            this._log('app', eventName, resolvedPayload);
        });
    }

    public triggerAllBoth(payload?: unknown): boolean {
        const localTriggered = this.triggerAllLocal(payload);
        const appTriggered = this.triggerAllApp(payload);
        return localTriggered || appTriggered;
    }

    public triggerLocalByIndex(index: number, payload?: unknown): boolean {
        return this.triggerLocal(index, payload);
    }

    public triggerAppByIndex(index: number, payload?: unknown): boolean {
        return this.triggerApp(index, payload);
    }

    /** Triggers the first configured local event, if present. */
    public triggerFirstLocal(payload?: unknown): boolean {
        return this.triggerLocal(0, payload);
    }

    /** Triggers the first configured app-wide event, if present. */
    public triggerFirstApp(payload?: unknown): boolean {
        return this.triggerApp(0, payload);
    }

    /** Triggers both channels using the first configured event names. */
    public triggerFirstBoth(payload?: unknown): boolean {
        return this.triggerBoth(0, payload);
    }

    /** Convenience helper for ScenarioManager NEXT event. */
    public triggerScenarioNext(payload?: unknown): boolean {
        return this.triggerApp(ScenarioManager.Event.NEXT, payload);
    }

    private _resolveEvent(token: EventToken, source: string[]): ResolvedEvent | null {
        if (Array.isArray(token)) {
            return null;
        }

        if (typeof token === 'string') {
            const eventName = token.trim();
            if (!eventName) {
                return null;
            }

            const eventIndex = source.findIndex(
                (configuredName) => (configuredName ?? '').trim() === eventName
            );
            return { eventName, eventIndex };
        }

        const safeIndex = Math.floor(Number(token));
        if (!Number.isFinite(safeIndex) || safeIndex < 0 || safeIndex >= source.length) {
            return null;
        }

        const eventName = (source[safeIndex] ?? '').trim();
        if (!eventName) {
            return null;
        }

        return { eventName, eventIndex: safeIndex };
    }

    private _resolveEvents(token: EventToken, source: string[]): ResolvedEvent[] {
        if (!Array.isArray(token)) {
            const single = this._resolveEvent(token, source);
            return single ? [single] : [];
        }

        const resolvedEvents: ResolvedEvent[] = [];
        for (let i = 0; i < token.length; i += 1) {
            const single = this._resolveEvent(token[i], source);
            if (!single) {
                continue;
            }
            resolvedEvents.push(single);
        }
        return resolvedEvents;
    }

    private _triggerAllEvents(
        source: string[],
        triggerEvent: (eventName: string, eventIndex: number) => void
    ): boolean {
        let triggered = false;
        for (let i = 0; i < source.length; i += 1) {
            const eventName = (source[i] ?? '').trim();
            if (!eventName) {
                continue;
            }
            triggerEvent(eventName, i);
            triggered = true;
        }
        return triggered;
    }

    private _triggerByToken(
        channel: RelayChannel,
        source: string[],
        token: EventToken,
        payload: unknown,
        emit: (eventName: string, resolvedPayload: unknown) => void
    ): boolean {
        const events = this._resolveEvents(token, source);
        if (events.length <= 0) {
            return false;
        }

        let triggered = false;
        for (let i = 0; i < events.length; i += 1) {
            const resolvedEvent = events[i];
            const resolvedPayload = this._resolvePayload(
                channel,
                resolvedEvent.eventIndex,
                payload
            );
            emit(resolvedEvent.eventName, resolvedPayload);
            this._log(channel, resolvedEvent.eventName, resolvedPayload);
            triggered = true;
        }
        return triggered;
    }

    private _resolvePayload(
        channel: RelayChannel,
        eventIndex: number,
        payload?: unknown
    ): unknown {
        const configuredPayload = this._getEventPayload(channel, eventIndex);
        if (configuredPayload.hasValue) {
            return configuredPayload.value;
        }

        if (payload !== undefined) {
            return payload;
        }
        return this._getInspectorPayload();
    }

    private _getEventPayload(
        channel: RelayChannel,
        eventIndex: number
    ): { hasValue: boolean; value: unknown } {
        if (eventIndex < 0) {
            return { hasValue: false, value: undefined };
        }

        const source =
            channel === 'local'
                ? this.localEventPayloadsJson
                : this.appEventPayloadsJson;
        const json = (source[eventIndex] ?? '').trim();
        if (!json) {
            return { hasValue: false, value: undefined };
        }

        const cacheKey = `${channel}:${eventIndex}`;
        const cached = this._eventPayloadCache.get(cacheKey);
        if (cached && cached.raw === json) {
            return { hasValue: cached.valid, value: cached.value };
        }

        try {
            const parsed = JSON.parse(json);
            this._eventPayloadCache.set(cacheKey, {
                raw: json,
                valid: true,
                value: parsed,
            });
            return { hasValue: true, value: parsed };
        } catch (error) {
            this._eventPayloadCache.set(cacheKey, {
                raw: json,
                valid: false,
                value: undefined,
            });
            console.warn(
                `[EventTriggerRelay] Invalid ${channel}EventPayloadsJson entry at index ${eventIndex} on node "${this.node.name}".`,
                error
            );
            return { hasValue: false, value: undefined };
        }
    }

    private _getInspectorPayload(): unknown {
        if (!this.useInspectorPayload) {
            return undefined;
        }

        const json = (this.inspectorPayloadJson ?? '').trim();
        if (!json) {
            return undefined;
        }

        if (
            this._hasCachedInspectorPayload &&
            this._cachedInspectorPayloadJson === json
        ) {
            return this._isCachedInspectorPayloadValid
                ? this._cachedInspectorPayload
                : undefined;
        }

        this._cachedInspectorPayloadJson = json;
        this._hasCachedInspectorPayload = true;

        try {
            this._cachedInspectorPayload = JSON.parse(json);
            this._isCachedInspectorPayloadValid = true;
            return this._cachedInspectorPayload;
        } catch (error) {
            this._cachedInspectorPayload = undefined;
            this._isCachedInspectorPayloadValid = false;
            console.warn(
                `[EventTriggerRelay] Invalid inspectorPayloadJson on node "${this.node.name}".`,
                error
            );
            return undefined;
        }
    }

    private _log(channel: 'local' | 'app', eventName: string, payload?: unknown): void {
        if (!this.debugLogs) {
            return;
        }
        console.log(`[EventTriggerRelay] ${channel}: ${eventName}`, payload);
    }
}
