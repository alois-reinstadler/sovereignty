import { getAuth } from "./auth.server";

export class UnauthenticatedRequestError extends Error {
	readonly name = "UnauthenticatedRequestError";
}

export const getAuthenticatedSession = async (headers: Headers) => {
	const session = await getAuth().api.getSession({ headers });
	if (!session) {
		throw new UnauthenticatedRequestError("Authentication is required");
	}
	return session;
};
