import type { LoginRendererHost, RenderContext } from "../../login/renderer/host";
import { withRenderTransform } from "../../login/renderer/layout/config";
import { withContentTransform } from "../../login/renderer/layout/geometry";
import { drawCenteredText } from "../../login/renderer/render/drawUtils";

export function drawEditModeLoadingScreen(host: LoginRendererHost, ctx: RenderContext): void {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, host.canvasWidth, host.canvasHeight);
    withRenderTransform(host, ctx, () => {
        withContentTransform(host, ctx, () => {
            const centerX = host.LOGIN_BOX_CENTER;
            if (host.fontBold12) {
                drawCenteredText(host, ctx, host.fontBold12, "Loading - please wait.", centerX, 245, 0xffffff);
            } else {
                ctx.font = "bold 13px Helvetica, Arial, sans-serif";
                ctx.fillStyle = "white";
                ctx.textAlign = "center";
                ctx.fillText("Loading - please wait.", centerX, 245);
            }
        });
    });
}
