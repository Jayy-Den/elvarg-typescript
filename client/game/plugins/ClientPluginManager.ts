import type { Camera } from "../Camera";
import type { InputManager } from "../InputManager";

export type CameraInputContext = {
    camera: Camera;
    input: InputManager;
    deltaTime: number;
};

export type CameraFollowContext = {
    camera: Camera;
    playerX: number;
    playerY?: number;
    playerZ: number;
};

export interface ClientPlugin {
    handleCameraKeys?(context: CameraInputContext): boolean;
    handleCameraMouse?(context: CameraInputContext): boolean;
    handleCameraScroll?(context: CameraInputContext): boolean;
    updateInteractionPointer?(camera: Camera): void;
    handleCameraFollow?(context: CameraFollowContext): boolean;
    shouldKeepWorldMenuOpen?(): boolean;
}

export class ClientPluginManager {
    private readonly plugins: ClientPlugin[] = [];

    add(plugin: ClientPlugin): void {
        this.plugins.push(plugin);
    }

    handleCameraKeys(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraKeys?.(context) === true);
    }

    handleCameraMouse(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraMouse?.(context) === true);
    }

    handleCameraScroll(context: CameraInputContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraScroll?.(context) === true);
    }

    updateInteractionPointer(camera: Camera): void {
        for (const plugin of this.plugins) plugin.updateInteractionPointer?.(camera);
    }

    handleCameraFollow(context: CameraFollowContext): boolean {
        return this.plugins.some((plugin) => plugin.handleCameraFollow?.(context) === true);
    }

    shouldKeepWorldMenuOpen(): boolean {
        return this.plugins.some((plugin) => plugin.shouldKeepWorldMenuOpen?.() === true);
    }

}
