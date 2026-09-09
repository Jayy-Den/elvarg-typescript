import * as PicoGL from "picogl";

declare module "picogl" {
    export interface DrawCall extends Omit<PicoGL.DrawCall, "numElements"> {
        offsets: number[];
        numElements: number[];
    }

    export interface Texture {
        bind(unit: number): void;
    }

    /**
     * `VertexBuffer` stores the allocated byte size at runtime but does not
     * declare it in the upstream typings.
     */
    export interface VertexBuffer {
        readonly byteLength: number;
    }

    import PicoGL, {
        App,
        DrawCall,
        VertexArray,
        VertexBuffer,
        Texture,
        Timer,
        Program,
        UniformBuffer,
    } from "picogl";

    export default PicoGL;
    export {
        PicoGL,
        App,
        DrawCall,
        VertexArray,
        VertexBuffer,
        Texture,
        Timer,
        Program,
        UniformBuffer,
    };
}
