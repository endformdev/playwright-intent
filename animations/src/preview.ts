import { startServer } from "./server.ts";

const port = Number(process.env.PORT ?? 4600);
const server = await startServer({ port, live: true });

console.log(`Previewing animations at ${server.url}`);
console.log(
	"Space plays and pauses, arrow keys step a frame (shift: a second).",
);
console.log("The page reloads, keeping its place, when a file in src changes.");
