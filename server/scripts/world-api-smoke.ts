import { strict as assert } from "assert";
import Fastify, { FastifyInstance } from "fastify";
import { DevelopmentApiServer } from "../src/main/typescript/elvarg/net/development/DevelopmentApiServer";

async function main(): Promise<void> {
    const app = Fastify({ logger: false });
    const configure = (
        DevelopmentApiServer as unknown as {
            configureAndListen(
                instance: FastifyInstance,
                host: string,
                port: number
            ): Promise<void>;
        }
    ).configureAndListen;
    await configure.call(DevelopmentApiServer, app, "127.0.0.1", 0);
    try {
        const response = await app.inject({ method: "GET", url: "/world" });
        assert.equal(response.statusCode, 200);
        const world = response.json();
        assert.deepEqual(world.spawn, { x: 3089, y: 3524, z: 0 });
        assert.equal(world.zones.length, 17);
        assert.deepEqual(world.zones[0], { tags: ["pvp"] }, "the global pvp fallback survives a read");

        const invalid = await app.inject({
            method: "POST",
            url: "/world/zones",
            headers: { "content-type": "application/json" },
            payload: {
                minX: 0,
                maxX: 1,
                minY: 0,
                maxY: 1,
                z: 0,
                tags: ["safe"],
            },
        });
        assert.equal(invalid.statusCode, 400);

        const missing = await app.inject({
            method: "PUT",
            url: "/world/zones/9999",
            headers: { "content-type": "application/json" },
            payload: world.zones[0],
        });
        assert.equal(missing.statusCode, 404);
        console.log("world api ok: GET /world, validated writes, indexed zone routes");
    } finally {
        await app.close();
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
