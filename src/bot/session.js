const db = require('../database');

async function getSession(key) {
    try {
        const [rows] = await db.query('SELECT data FROM user_sessions WHERE id = $1', [key]);
        if (rows && rows.length > 0) {
            return JSON.parse(rows[0].data);
        }
    } catch (e) {
        console.error('Failed to get session:', e.message);
    }
    return {};
}

async function saveSession(key, data) {
    try {
        if (!data || Object.keys(data).length === 0) {
            await db.query('DELETE FROM user_sessions WHERE id = $1', [key]);
            return;
        }
        const jsonData = JSON.stringify(data);
        const query = `
            INSERT INTO user_sessions (id, data, updated_at) 
            VALUES ($1, $2, CURRENT_TIMESTAMP) 
            ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
        `;
        
        try {
            await db.query(query, [key, jsonData]);
        } catch (e) {
            if (e.message.includes('column "updated_at"') && e.message.includes('does not exist')) {
                const fallbackQuery = `
                    INSERT INTO user_sessions (id, data) 
                    VALUES ($1, $2) 
                    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                `;
                await db.query(fallbackQuery, [key, jsonData]);
            } else {
                throw e;
            }
        }
    } catch (e) {
        console.error('Failed to save session:', e.message);
    }
}

function pgSession() {
    return async (ctx, next) => {
        const key = ctx.chat?.id && ctx.from?.id ? `${ctx.chat.id}:${ctx.from.id}` : null;
        
        let sessionData = {};
        if (key) {
            sessionData = await getSession(key);
        }

        Object.defineProperty(ctx, 'session', {
            get: function() { return sessionData; },
            set: function(val) { sessionData = val; }
        });

        await next();

        if (key) {
            await saveSession(key, ctx.session);
        }
    };
}

module.exports = pgSession;
