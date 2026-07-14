import { _decorator } from 'cc';
import {
    ScenarioManager,
    ScenarioStep,
} from '../Presentation/ScenarioManager_Cocos388';
import { MuzioPlayableEvent } from './MuzioPlayableEvents';

const { ccclass } = _decorator;

/**
 * Required entity keys:
 * moodScreen, moodController, songScreen, playlistController,
 * generatingOverlay, endCard, endCardPop, ctaPulse.
 */
@ccclass('MuzioScenarioManager')
export class MuzioScenarioManager extends ScenarioManager {
    public buildScenario(): ScenarioStep[] {
        return [
            {
                id: 'setup',
                mode: 'sequence',
                next: 'auto',
                actions: [
                    {
                        type: 'call',
                        target: 'moodController',
                        component: 'MoodSelectionController',
                        method: 'resetSelection',
                    },
                    {
                        type: 'call',
                        target: 'playlistController',
                        component: 'MuzioPlaylistController',
                        method: 'resetPlayable',
                    },
                    {
                        type: 'call',
                        target: 'endCardPop',
                        component: 'NodePopInOut',
                        method: 'captureBaseScale',
                    },
                    {
                        type: 'call',
                        target: 'endCardPop',
                        component: 'NodePopInOut',
                        method: 'snapOut',
                    },
                    {
                        type: 'call',
                        target: 'ctaPulse',
                        component: 'RelativeScalePulser',
                        method: 'stopPulse',
                        args: [true],
                    },
                    {
                        type: 'parallel',
                        actions: [
                            { type: 'enable', target: 'moodScreen', value: false },
                            { type: 'enable', target: 'songScreen', value: false },
                            { type: 'enable', target: 'generatingOverlay', value: false },
                            { type: 'enable', target: 'endCard', value: false },
                        ],
                    },
                ],
            },
            {
                id: 'chooseMood',
                mode: 'sequence',
                next: 'auto',
                actions: [
                    { type: 'enable', target: 'moodScreen', value: true },
                    {
                        type: 'call',
                        target: 'moodController',
                        component: 'MoodSelectionController',
                        method: 'enableSelection',
                    },
                    { type: 'waitEvent', event: MuzioPlayableEvent.MOOD_SELECTED },
                ],
            },
            {
                id: 'chooseSongs',
                mode: 'sequence',
                next: 'auto',
                actions: [
                    {
                        type: 'call',
                        target: 'moodController',
                        component: 'MoodSelectionController',
                        method: 'disableSelection',
                    },
                    { type: 'enable', target: 'moodScreen', value: false },
                    { type: 'enable', target: 'songScreen', value: true },
                    {
                        type: 'call',
                        target: 'playlistController',
                        component: 'MuzioPlaylistController',
                        method: 'beginSongSelection',
                    },
                    { type: 'waitEvent', event: MuzioPlayableEvent.PLAYLIST_READY },
                ],
            },
            {
                id: 'generatePlaylist',
                mode: 'sequence',
                next: 'auto',
                actions: [
                    {
                        type: 'call',
                        target: 'playlistController',
                        component: 'MuzioPlaylistController',
                        method: 'disableSongDragging',
                    },
                    { type: 'enable', target: 'generatingOverlay', value: true },
                    {
                        type: 'call',
                        target: 'playlistController',
                        component: 'MuzioPlaylistController',
                        method: 'generatePlaylist',
                    },
                    { type: 'enable', target: 'generatingOverlay', value: false },
                    { type: 'enable', target: 'songScreen', value: false },
                ],
            },
            {
                id: 'showEndCard',
                mode: 'sequence',
                next: 'wait',
                actions: [
                    { type: 'enable', target: 'endCard', value: true },
                    {
                        type: 'call',
                        target: 'endCardPop',
                        component: 'NodePopInOut',
                        method: 'popIn',
                        args: [true, 0.28, 'backOut'],
                    },
                    {
                        type: 'call',
                        target: 'ctaPulse',
                        component: 'RelativeScalePulser',
                        method: 'pulseWithConfig',
                        args: [1, 0.65, false, [1.06, 1.06, 1], 'sineInOut', true],
                    },
                ],
            },
        ];
    }
}
