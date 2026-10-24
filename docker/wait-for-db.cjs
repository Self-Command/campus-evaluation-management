const { Client } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("[wait-for-db] DATABASE_URL is required.");
    process.exit(1);
}

const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 60000);
const deadline = Date.now() + timeoutMs;
let attempt = 0;

async function probe() {
    attempt += 1;
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
        await client.connect();
        await client.query("SELECT 1");
        await client.end();
        console.log(`[wait-for-db] Database ready after ${attempt} attempt(s).`);
        return true;
    } catch (error) {
        await client.end().catch(() => {});
        return false;
    }
}

(async () => {
    while (Date.now() < deadline) {
        if (await probe()) process.exit(0);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.error(`[wait-for-db] Database was not ready within ${Math.round(timeoutMs / 1000)} seconds.`);
    process.exit(1);
})();
