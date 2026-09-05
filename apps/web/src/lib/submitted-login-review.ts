import {
	normalizeOrigin,
	PROPOSAL_TTL_MS,
	parseSubmissionProposal,
	type SubmissionProposal,
} from "@svrgn/extension-protocol";
import {
	addVaultItem,
	createVaultItem,
	updateVaultItem,
} from "@svrgn/vault-core";
import type { VaultDocument, VaultItem } from "./models";
export type SubmissionReviewView = {
	id: string;
	origin: string;
	username: string;
	expiresAt: number;
	matches: { id: string; title: string; username: string }[];
};
export type SubmissionPersist = (
	update: (document: VaultDocument) => VaultDocument,
) => Promise<boolean>;
type PendingReview = {
	proposal: SubmissionProposal;
	matches: Map<string, VaultItem>;
	isLive: () => boolean;
};
/** At most one bounded proposal; React receives metadata, never its password. */
export class SubmittedLoginReviews {
	private pending: PendingReview | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(
		private readItems: () => ReadonlyArray<VaultItem> | null,
		private persist: SubmissionPersist,
		private onView: (view: SubmissionReviewView | null) => void,
		private now: () => number = Date.now,
	) {}
	cancel() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.pending) {
			this.pending.proposal.username = "";
			this.pending.proposal.password = "";
			this.pending.matches.clear();
		}
		this.pending = null;
		this.onView(null);
	}
	offer(value: unknown, isLive: () => boolean): boolean {
		this.cancel();
		const proposal = parseSubmissionProposal(value);
		const items = this.readItems();
		const now = this.now();
		if (
			!proposal ||
			!items ||
			!isLive() ||
			proposal.expiresAt <= now ||
			proposal.expiresAt > now + PROPOSAL_TTL_MS
		)
			return false;
		const matches = new Map(
			items
				.filter((item) => normalizeOrigin(item.website) === proposal.origin)
				.slice(0, 50)
				.map((item) => [item.id, item]),
		);
		this.pending = { proposal: { ...proposal }, matches, isLive };
		this.timer = setTimeout(() => this.cancel(), proposal.expiresAt - now);
		this.onView({
			id: proposal.id,
			origin: proposal.origin,
			username: proposal.username,
			expiresAt: proposal.expiresAt,
			matches: Array.from(matches.values(), ({ id, title, username }) => ({
				id,
				title,
				username,
			})),
		});
		return true;
	}
	async approve(id: string, targetId: string | null): Promise<boolean> {
		const pending = this.pending;
		if (!pending || pending.proposal.id !== id) return false;
		const { proposal } = pending;
		const valid = () =>
			pending.isLive() &&
			this.readItems() !== null &&
			this.now() < proposal.expiresAt;
		if (!valid()) {
			this.cancel();
			return false;
		}
		// Approval consumes the proposal. A later cancel cannot undo approved encryption.
		this.pending = null;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.onView(null);
		try {
			return await this.persist((document) => {
				if (!valid()) throw new Error("Submission approval expired or locked.");
				if (targetId === null)
					return addVaultItem(
						document,
						createVaultItem({
							title: new URL(proposal.origin).hostname,
							website: proposal.origin,
							username: proposal.username,
							password: proposal.password,
						}),
					);
				const expected = pending.matches.get(targetId);
				const current = document.items.find((item) => item.id === targetId);
				// Vault updates replace immutable record objects. Any replacement, including
				// a sync revision with equal timestamps, invalidates the displayed choice.
				if (
					!expected ||
					current !== expected ||
					normalizeOrigin(current.website) !== proposal.origin
				)
					throw new Error(
						"The selected login changed. Capture and review again.",
					);
				return updateVaultItem(document, targetId, {
					username: proposal.username,
					password: proposal.password,
				});
			});
		} catch {
			return false;
		} finally {
			proposal.username = "";
			proposal.password = "";
			pending.matches.clear();
		}
	}
}
