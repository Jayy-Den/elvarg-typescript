import type { Camera } from "../../Camera";
import type { InputKeyHandler, InputManager, InputMouseHandler } from "../../InputManager";
import type { CameraFollowContext, CameraInputContext, ClientPlugin } from "../ClientPluginManager";

if (typeof document !== "undefined") require("./FirstPersonPlugin.css");

type FirstPersonClient = {
    camera: Camera;
    inputManager: InputManager;
    renderSelf: boolean;
    followPlayerCamera: boolean;
    menuOpen: boolean;
    isLoggedIn(): boolean;
    closeMenu(): void;
};

type CursorMode = "none" | "alt" | "menu";

export class FirstPersonPlugin implements ClientPlugin, InputKeyHandler, InputMouseHandler {
    private enabled = false;
    private cursorMode: CursorMode = "none";
    private awaitingMenuOpen = false;
    private menuOpenChecked = false;
    private menuCursorMoved = false;
    private ignoreNextMenuMouseMove = false;
    private restoreRenderSelf?: boolean;
    private restoreFollowPlayerCamera?: boolean;

    constructor(private readonly client: FirstPersonClient) {
        client.inputManager.addKeyHandler(this);
        client.inputManager.addMouseHandler(this);
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
            if (this.cursorMode === "alt") this.resumeMouseLook();
            else this.unlockCursor("alt");
            return true;
        }
        return false;
    }

    onKeyUp(event: KeyboardEvent): boolean {
        return this.enabled && (event.code === "AltLeft" || event.code === "AltRight");
    }

    onMouseDown(event: MouseEvent): void {
        if (!this.enabled || event.button !== 0 && event.button !== 2) return;
        if (event.button === 2 && this.cursorMode === "none") {
            this.awaitingMenuOpen = true;
            this.menuOpenChecked = false;
            this.menuCursorMoved = false;
            this.ignoreNextMenuMouseMove = true;
            this.unlockCursor("menu");
            return;
        }
        if (this.cursorMode !== "menu" || !this.client.menuOpen) return;
        if (event.button === 0) {
            // Leave the menu state intact until its existing click handler invokes or cancels it.
            this.resumeMouseLook();
        } else if (event.button === 2) {
            this.closeWorldMenu();
            this.client.inputManager.clickMode1 = 0;
            this.client.inputManager.clickMode2 = 0;
            if (this.cursorMode === "menu") this.resumeMouseLook();
        }
    }

    onMouseMove(event: MouseEvent): void {
        if (!this.enabled || this.cursorMode !== "menu" || !this.client.menuOpen) return;
        if (this.ignoreNextMenuMouseMove) {
            this.ignoreNextMenuMouseMove = false;
            return;
        }
        if (event.movementX !== 0 || event.movementY !== 0) this.menuCursorMoved = true;
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
        if (this.client.menuOpen) {
            if (this.cursorMode === "none") this.unlockCursor("menu");
            this.awaitingMenuOpen = false;
        } else if (
            this.cursorMode === "menu" &&
            (!this.awaitingMenuOpen || this.menuOpenChecked)
        ) {
            this.resumeMouseLook();
        }
        if (this.cursorMode !== "none" || !input.isPointerLock()) return true;
        const deltaX = input.getDeltaMouseX();
        const deltaY = input.getDeltaMouseY();
        if (deltaX !== 0 || deltaY !== 0) {
            camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaY * 0.9);
            camera.updateYaw(camera.yaw, -deltaX * 0.9);
        }
        return true;
    }

    handleCameraScroll({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled || input.wheelDeltaY === 0) return false;
        camera.setViewZoomScale(camera.getViewZoomScale() - input.wheelDeltaY * 0.001);
        return true;
    }

    updateInteractionPointer(camera: Camera): void {
        const input = this.client.inputManager;
        this.updateReticleVisibility();
        if (!this.client.isLoggedIn()) {
            input.clearInteractionPointerOverride();
            return;
        }
        const waitingForMenu = this.cursorMode === "menu" && !this.client.menuOpen;
        const holdMenuPointer =
            this.cursorMode === "menu" && this.client.menuOpen && !this.menuCursorMoved;
        if (holdMenuPointer) {
            input.clearInteractionPointerOverride();
            input.mouseX = camera.viewportXOffset + camera.viewportWidth / 2;
            input.mouseY = camera.viewportYOffset + camera.viewportHeight / 2;
            return;
        }
        if (
            !this.enabled ||
            (!waitingForMenu && this.cursorMode !== "none") ||
            (this.cursorMode === "none" && !input.isPointerLock())
        ) {
            input.clearInteractionPointerOverride();
            return;
        }
        const x = camera.viewportXOffset + camera.viewportWidth / 2;
        const y = camera.viewportYOffset + camera.viewportHeight / 2;
        input.mouseX = x;
        input.mouseY = y;
        input.setInteractionPointerOverride(x, y);
        if (waitingForMenu) this.menuOpenChecked = true;
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

    shouldKeepWorldMenuOpen(): boolean {
        return this.enabled && this.client.menuOpen;
    }

    private setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.cursorMode = "none";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        this.menuCursorMoved = false;
        this.ignoreNextMenuMouseMove = false;
        const { inputManager: input, camera } = this.client;
        input.enablePointerLock = enabled;
        input.clearInteractionPointerOverride();
        this.closeWorldMenu();
        this.updateReticleVisibility();
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
        camera.setViewZoomScale(1);
        if (this.restoreRenderSelf !== undefined) this.client.renderSelf = this.restoreRenderSelf;
        if (this.restoreFollowPlayerCamera !== undefined) this.client.followPlayerCamera = this.restoreFollowPlayerCamera;
        this.restoreRenderSelf = undefined;
        this.restoreFollowPlayerCamera = undefined;
        input.releasePointerLock();
    }

    private unlockCursor(mode: Exclude<CursorMode, "none">): void {
        this.cursorMode = mode;
        this.client.inputManager.enablePointerLock = false;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.releasePointerLock();
    }

    private resumeMouseLook(): void {
        this.cursorMode = "none";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        this.menuCursorMoved = false;
        this.ignoreNextMenuMouseMove = false;
        this.client.inputManager.enablePointerLock = true;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.requestPointerLock();
    }

    private closeWorldMenu(): void {
        this.client.closeMenu();
        const canvas = this.client.inputManager.element as
            | (HTMLCanvasElement & { __ui?: { menu?: { source?: string; open?: boolean } } })
            | undefined;
        if (canvas?.__ui?.menu?.source === "map") {
            canvas.__ui.menu.open = false;
            canvas.__ui.menu = undefined;
        }
    }

    private updateReticleVisibility(): void {
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-reticle",
            this.enabled && this.client.isLoggedIn(),
        );
    }
}
