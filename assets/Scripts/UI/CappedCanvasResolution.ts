import {
    _decorator,
    Component,
    ResolutionPolicy,
    screen,
    view,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('CappedCanvasResolution')
export class CappedCanvasResolution extends Component {
    @property({
        tooltip: 'The vertical design resolution used when creating the UI.',
    })
    designHeight = 1920;

    @property({
        tooltip: 'Maximum logical width divided by logical height. Example: 0.75 = 3:4.',
    })
    maxAspectRatio = 0.5625;

    @property({
        tooltip: 'Optional minimum width-to-height ratio. Set to 0 to disable.',
    })
    minAspectRatio = 0;

    protected start(): void {
        this.applyResolution();

        screen.on(
            'window-resize',
            this.onWindowResize,
            this,
        );
    }

    protected onDestroy(): void {
        screen.off(
            'window-resize',
            this.onWindowResize,
            this,
        );
    }

    private onWindowResize(width: number, height: number): void {
        this.applyResolution(width, height);
    }

    private applyResolution(
        screenWidth: number = screen.windowSize.width,
        screenHeight: number = screen.windowSize.height,
    ): void {
        if (screenWidth <= 0 || screenHeight <= 0) {
            return;
        }

        const screenAspect = screenWidth / screenHeight;

        let targetAspect = Math.min(
            screenAspect,
            this.maxAspectRatio,
        );

        if (this.minAspectRatio > 0) {
            targetAspect = Math.max(
                targetAspect,
                this.minAspectRatio,
            );
        }

        const targetWidth = Math.round(
            this.designHeight * targetAspect,
        );

        view.setDesignResolutionSize(
            targetWidth,
            this.designHeight,
            ResolutionPolicy.SHOW_ALL,
        );

        console.log(
            `[Canvas Resolution] ${targetWidth} × ${this.designHeight}, ` +
            `screen aspect: ${screenAspect.toFixed(3)}, ` +
            `used aspect: ${targetAspect.toFixed(3)}`,
        );
    }
}