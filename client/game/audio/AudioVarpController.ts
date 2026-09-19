import {
    VARP_AREA_SOUNDS_VOLUME,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../common/vars";
import { setOsrsInterfaceScalingPercent } from "../../ui/UiScale";
import type { GameRenderer } from "../GameRenderer";
import type { MusicSystem } from "../audio/MusicSystem";
import type { SoundEffectSystem } from "../audio/SoundEffectSystem";
import { clamp } from "../../common/utils/MathUtil";

export type AudioVarpControllerDeps = {
    getMusicSystem: () => MusicSystem | undefined;
    getSoundEffectSystem: () => SoundEffectSystem | undefined;
    getRenderer: () => GameRenderer | undefined;
    getMasterVolume: () => number;
    setMasterVolume: (value: number) => void;
    getMusicVolume: () => number;
    setMusicVolume: (value: number) => void;
    getSfxVolume: () => number;
    setSfxVolume: (value: number) => void;
    getAmbientVolume: () => number;
    setAmbientVolume: (value: number) => void;
};

/**
 * Applies audio varp/device-option changes and UI scaling refresh.
 */
export class AudioVarpController {
    constructor(private readonly deps: AudioVarpControllerDeps) {}

    applyMasterVolume(): void {
        const master = this.deps.getMasterVolume();
        const musicSystem = this.deps.getMusicSystem();
        const soundEffectSystem = this.deps.getSoundEffectSystem();
        if (musicSystem) {
            musicSystem.setVolume(this.deps.getMusicVolume() * master);
        }
        if (soundEffectSystem) {
            soundEffectSystem.setVolume(this.deps.getSfxVolume() * master);
            soundEffectSystem.setAmbientVolume(this.deps.getAmbientVolume() * master);
        }
    }

    refreshUiScalingLayout(): void {
        try {
            const renderer = this.deps.getRenderer();
            const canvas = renderer?.canvas;
            if (!renderer || !canvas) return;
            const width = canvas.width | 0;
            const height = canvas.height | 0;
            if (width <= 0 || height <= 0) return;
            renderer.onResize(width, height);
        } catch (error) {
            console.log("[OsrsClient] Failed to refresh UI scaling layout", { error });
        }
    }

    applyInterfaceScalingPercentDeviceOption(value: number): void {
        // The rev-240 login-init script (4618→7455) unconditionally requests
        // 400% interface scaling on every login. That matches real phones
        // (tiny canvas, chunky UI) but on desktop/preview canvases rendered
        // at design resolution it makes the gameframe four times too large.
        // Cap the applied scale so the layout keeps matching the mobile refs;
        // the raw value is still stored for getDeviceOption parity.
        // Cap at 100%: the refs' proportions (panel ≈16% of frame width)
        // are the 100% layout at any canvas size, and 100% also clears the
        // persisted override so no stale zoom survives a reload.
        const percent = Math.min(Math.max(value | 0, 100), 100);
        setOsrsInterfaceScalingPercent(percent);
        this.refreshUiScalingLayout();
    }

    applyAudioVarpChange(varpId: number, value: number): void {
        const percent = clamp(value | 0, 0, 100);
        const curved = Math.round((percent * percent) / 100);

        if (varpId === VARP_MUSIC_VOLUME) {
            const scaled = Math.round((curved * 255) / 100);
            this.deps.setMusicVolume(Math.max(0, Math.min(1, scaled / 255)));
            const musicSystem = this.deps.getMusicSystem();
            if (musicSystem) {
                musicSystem.setVolume(this.deps.getMusicVolume() * this.deps.getMasterVolume());
            }
            return;
        }

        if (varpId === VARP_SOUND_EFFECTS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this.deps.setSfxVolume(Math.max(0, Math.min(1, scaled / 127)));
            const soundEffectSystem = this.deps.getSoundEffectSystem();
            if (soundEffectSystem) {
                soundEffectSystem.setVolume(this.deps.getSfxVolume() * this.deps.getMasterVolume());
            }
            return;
        }

        if (varpId === VARP_AREA_SOUNDS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this.deps.setAmbientVolume(Math.max(0, Math.min(1, scaled / 127)));
            const soundEffectSystem = this.deps.getSoundEffectSystem();
            if (soundEffectSystem) {
                soundEffectSystem.setAmbientVolume(
                    this.deps.getAmbientVolume() * this.deps.getMasterVolume(),
                );
            }
            return;
        }

        if (varpId === VARP_MASTER_VOLUME) {
            this.deps.setMasterVolume(Math.max(0, Math.min(1, curved / 100)));
            this.applyMasterVolume();
        }
    }
}
