import { EventTarget } from 'cc';
import type { ScannableTarget } from '../Detection/ScannableTarget';

export const PlayableEvents = new EventTarget();

export const PlayableEvent = {
    TARGET_SCAN_STARTED: 'target:scan-started',
    TARGET_SCAN_COMPLETED: 'target:scan-completed',
    TARGET_SCAN_WRONG: 'target:scan-wrong',
    SESSION_COMPLETE: 'session:complete',
    HINT_DISMISSED: 'hint:dismissed',
    QUEST_COMPLETE: 'quest:complete',
    CTA_CLICKED: 'cta:clicked',
    PANEL_SHOWN: 'panel:shown',
} as const;

export interface TargetScanStartedPayload {
    target: ScannableTarget;
}

export interface TargetScanCompletedPayload {
    target: ScannableTarget;
}

export interface TargetScanWrongPayload {
    target: ScannableTarget;
}
