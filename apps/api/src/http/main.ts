import { startApiServer } from "./server.ts";

const { url } = await startApiServer();
console.log(`wiresleuth api listening on ${url}`);
