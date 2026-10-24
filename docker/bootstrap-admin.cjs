const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { hash } = require("bcryptjs");

const login = (process.env.BOOTSTRAP_ADMIN_LOGIN || "").trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
const name = (process.env.BOOTSTRAP_ADMIN_NAME || "系统管理员").trim() || "系统管理员";

if (!login && !password) process.exit(0);
if (!login || !password) {
    console.error("[bootstrap-admin] BOOTSTRAP_ADMIN_LOGIN and BOOTSTRAP_ADMIN_PASSWORD must be set together.");
    process.exit(1);
}
if (!/^[a-zA-Z0-9._-]{3,64}$/.test(login)) {
    console.error("[bootstrap-admin] BOOTSTRAP_ADMIN_LOGIN must be 3-64 characters: letters, digits, dot, underscore or hyphen.");
    process.exit(1);
}
if (password.length < 12 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    console.error("[bootstrap-admin] BOOTSTRAP_ADMIN_PASSWORD must be 12-72 characters and contain letters and digits.");
    process.exit(1);
}

(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(72109311)");
        const existing = await client.query('SELECT 1 FROM "User" WHERE role = \'ADMIN\' LIMIT 1');
        if (existing.rowCount) {
            await client.query("COMMIT");
            console.log("[bootstrap-admin] An administrator already exists; bootstrap skipped.");
            return;
        }
        const userId = randomUUID();
        const passwordHash = await hash(password, 12);
        await client.query(
            `INSERT INTO "User" (id, login, name, role, "passwordHash", "mustChangePassword", disabled, "authVersion", "createdAt", "updatedAt", revision)
             VALUES ($1, $2, $3, 'ADMIN', $4, true, false, 0, now(), now(), 0)`,
            [userId, login, name, passwordHash],
        );
        await client.query(
            `INSERT INTO "AuditEvent" (id, "actorId", action, "targetId", details, "createdAt")
             VALUES ($1, $2, 'INITIAL_ADMIN_CREATED', $2, NULL, now())`,
            [randomUUID(), userId],
        );
        await client.query("COMMIT");
        console.log(`[bootstrap-admin] Initial administrator "${login}" created; password change is required at first login.`);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        await client.end();
    }
})().catch((error) => {
    console.error("[bootstrap-admin] Failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
