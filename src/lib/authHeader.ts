import { getAuth } from 'firebase/auth';

/**
 * Build the Authorization header for calls to HCloud's own API.
 *
 * The Vercel functions under /api and the Render upload server both verify the
 * Firebase ID token's RS256 signature, so every privileged call must carry one.
 *
 * `getIdToken()` refreshes the token automatically when it is close to expiry,
 * so this is safe to call on every request rather than caching the value.
 */
export async function getIdTokenHeader(): Promise<Record<string, string>> {
    const user = getAuth().currentUser;
    if (!user) return {};
    try {
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
    } catch (err) {
        console.error('[auth] Failed to get ID token:', err);
        return {};
    }
}
