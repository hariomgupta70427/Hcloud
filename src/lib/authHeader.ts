import { getAuth } from 'firebase/auth';

/** Thrown when there is no live Firebase session to authenticate with. */
export class NotSignedInError extends Error {
    constructor() {
        super('Your session has expired. Please sign in again.');
        this.name = 'NotSignedInError';
    }
}

/**
 * Build the Authorization header for calls to HCloud's own API.
 *
 * The Vercel functions under /api and the Render upload server both verify the
 * Firebase ID token's RS256 signature, so every privileged call must carry one.
 *
 * This THROWS when there is no signed-in user rather than returning an empty
 * header. Returning `{}` meant requests went out unauthenticated and came back
 * as a bare `401 Missing or invalid Authorization header`, which looked like a
 * server bug and got retried several times before surfacing — when the real
 * problem was simply that the session had expired and the user needed to
 * sign in again.
 *
 * `getIdToken()` refreshes the token automatically when it is close to expiry,
 * so this is safe to call on every request rather than caching the value.
 */
export async function getIdTokenHeader(): Promise<Record<string, string>> {
    const user = getAuth().currentUser;
    if (!user) throw new NotSignedInError();

    try {
        const token = await user.getIdToken();
        return { Authorization: `Bearer ${token}` };
    } catch (err) {
        console.error('[auth] Failed to get ID token:', err);
        throw new NotSignedInError();
    }
}

/** True when an error means "no valid session" rather than a transient failure. */
export function isAuthError(err: unknown): boolean {
    return err instanceof NotSignedInError;
}
