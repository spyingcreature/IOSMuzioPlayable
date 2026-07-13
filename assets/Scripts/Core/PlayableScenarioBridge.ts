import { _decorator, Component } from 'cc';
import { ScenarioManager } from '../Presentation/ScenarioManager_Cocos388';
import {
    PlayableEvent,
    PlayableEvents,
} from './PlayableEvents';

const { ccclass, property } = _decorator;

@ccclass('PlayableScenarioBridge')
export class PlayableScenarioBridge extends Component {
    @property
    public debugLogs = false;

    private _boundHandlers: Array<{
        playableEvent: string;
        scenarioEvent: string;
        handler: () => void;
    }> = [];

    protected onEnable(): void {
        this._bind(
            PlayableEvent.HINT_DISMISSED,
            'hint:dismissed',
        );
        this._bind(
            PlayableEvent.QUEST_COMPLETE,
            'quest:complete',
        );
        this._bind(
            PlayableEvent.PANEL_SHOWN,
            'panel:shown',
        );
    }

    protected onDisable(): void {
        for (let i = 0; i < this._boundHandlers.length; i += 1) {
            const entry = this._boundHandlers[i];
            PlayableEvents.off(entry.playableEvent, entry.handler, this);
        }
        this._boundHandlers.length = 0;
    }

    private _bind(playableEvent: string, scenarioEvent: string): void {
        const handler = (): void => {
            this._log('relay', playableEvent, '->', scenarioEvent);
            ScenarioManager.events.emit(scenarioEvent);
        };

        PlayableEvents.on(playableEvent, handler, this);
        this._boundHandlers.push({
            playableEvent,
            scenarioEvent,
            handler,
        });
    }

    private _log(...args: unknown[]): void {
        if (!this.debugLogs) {
            return;
        }
        console.log('[PlayableScenarioBridge]', ...args);
    }
}
