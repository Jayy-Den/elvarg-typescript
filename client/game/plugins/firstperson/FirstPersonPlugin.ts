import type { Camera } from "../../Camera";
import type { InputKeyHandler, InputManager } from "../../InputManager";
import type { CameraFollowContext, CameraInputContext, ClientPlugin } from "../ClientPluginManager";

if (typeof document !== "undefined") require("./FirstPersonPlugin.css");

type FirstPersonClient = {
    camera: Camera;
    inputManager: InputManager;
    renderSelf: boolean;
    followPlayerCamera: boolean;
};

export class FirstPersonPlugin implements ClientPlugin, InputKeyHandler {
    private enabled = false;
    private cursorUnlocked = false;
    private restoreRenderSelf?: boolean;
    private restoreFollowPlayerCamera?: boolean;

    constructor(private readonly client: FirstPersonClient) {
        client.inputManager.addKeyHandler(this);
    }

    onKeyDown(event: KeyboardEvent): boolean {
        if (event.code === "F4" && !event.repeat) {
            this.setEnabled(!this.enabled);
            return true;
        }
        if (
            (event.code === "AltLeft" || event.code === "AltRight") &&
            this.enabled &&
            !event.repeat
        ) {
            this.cursorUnlocked = !this.cursorUnlocked;
            if (this.cursorUnlocked) this.client.inputManager.releasePointerLock();
            else this.client.inputManager.requestPointerLock();
            return true;
        }
        return false;
    }

    onKeyUp(event: KeyboardEvent): boolean {
        return this.enabled && (event.code === "AltLeft" || event.code === "AltRight");
    }

    handleCameraKeys({ camera, input, deltaTime }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        const deltaPitch = (64 * 8 * deltaTime) / 1000;
        const deltaYaw = (512 * deltaTime) / 1000;
        // First-person arrows intentionally run opposite to the normal camera controls.
        if (input.isKeyDown("ArrowUp")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaPitch);
        if (input.isKeyDown("ArrowDown")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) + deltaPitch);
        if (input.isKeyDown("ArrowRight")) camera.updateYaw(camera.yaw, deltaYaw);
        if (input.isKeyDown("ArrowLeft")) camera.updateYaw(camera.yaw, -deltaYaw);
        return true;
    }

    handleCameraMouse({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        if (this.cursorUnlocked || !input.isPointerLock()) return true;
        const deltaX = input.getDeltaMouseX();
        const deltaY = input.getDeltaMouseY();
        if (deltaX !== 0 || deltaY !== 0) {
            camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaY * 0.9);
            camera.updateYaw(camera.yaw, -deltaX * 0.9);
        }
        return true;
    }

    updateInteractionPointer(camera: Camera): void {
        const input = this.client.inputManager;
        if (!this.enabled || this.cursorUnlocked || !input.isPointerLock()) {
            input.clearInteractionPointerOverride();
            return;
        }
        const x = camera.viewportXOffset + camera.viewportWidth / 2;
        const y = camera.viewportYOffset + camera.viewportHeight / 2;
        input.setInteractionPointerOverride(x, y);
        const canvas = input.element as HTMLCanvasElement | undefined;
        const host = canvas?.parentElement;
        if (host && canvas?.width && canvas.height) {
            host.style.setProperty("--first-person-reticle-x", `${(x / canvas.width) * 100}%`);
            host.style.setProperty("--first-person-reticle-y", `${(y / canvas.height) * 100}%`);
        }
    }

    handleCameraFollow({ camera, playerX, playerY, playerZ }: CameraFollowContext): boolean {
        if (!this.enabled) return false;
        camera.snapToPosition(
            playerX,
            playerY === undefined ? undefined : Math.round((playerY - 1.5) * 128) / 128,
            playerZ,
        );
        return true;
    }

    private setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.cursorUnlocked = false;
        const { inputManager: input, camera } = this.client;
        input.enablePointerLock = enabled;
        input.clearInteractionPointerOverride();
        input.element?.parentElement?.classList.toggle("first-person-reticle", enabled);
        if (enabled) {
            this.restoreRenderSelf = this.client.renderSelf;
            this.restoreFollowPlayerCamera = this.client.followPlayerCamera;
            this.client.renderSelf = false;
            this.client.followPlayerCamera = true;
            camera.setViewPitchOverride(0);
            input.requestPointerLock();
            return;
        }
        camera.setViewPitchOverride(undefined);
        if (this.restoreRenderSelf !== undefined) this.client.renderSelf = this.restoreRenderSelf;
        if (this.restoreFollowPlayerCamera !== undefined) this.client.followPlayerCamera = this.restoreFollowPlayerCamera;
        this.restoreRenderSelf = undefined;
        this.restoreFollowPlayerCamera = undefined;
        input.releasePointerLock();
    }
}
