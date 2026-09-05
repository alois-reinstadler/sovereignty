// Imported only by the separate acceptance entry in a disposable simulator.
import { nativeCrypto } from "./native-crypto";
import { nativeStore } from "./native-storage";
import { MobileVault, type VaultSession } from "./vault";

export async function runNativeStorage() {
	let stage = "initialize";
	const sessions: VaultSession[] = [];
	let vault: MobileVault | undefined;
	try {
		vault = new MobileVault(nativeCrypto());
		const store = nativeStore();
		if ((await store.load()) !== null)
			throw new Error("Acceptance requires an empty synthetic sandbox");
		stage = "create-and-publish";
		const password = "synthetic native filesystem acceptance";
		const created = vault.create(password);
		sessions.push(created.session);
		await store.write(created.envelope);
		stage = "reload-and-unlock";
		const persisted = await nativeStore().load();
		if (!persisted) throw new Error("Missing published envelope");
		const reopened = vault.unlock(persisted, password);
		sessions.push(reopened);
		stage = "update-and-publish";
		const now = new Date().toISOString();
		reopened.document = {
			...reopened.document,
			updatedAt: now,
			items: [
				{
					id: vault.id(),
					title: "Native persistence fixture",
					username: "native-file@example.invalid",
					password: "synthetic storage fixture password",
					website: "",
					notes: "",
					favorite: false,
					createdAt: now,
					updatedAt: now,
				},
			],
		};
		await store.write(vault.seal(reopened, persisted));
		stage = "restore-updated-login";
		const updated = await nativeStore().load();
		if (!updated) throw new Error("Missing updated envelope");
		const restored = vault.unlock(updated, password);
		sessions.push(restored);
		if (restored.document.items[0]?.username !== "native-file@example.invalid")
			throw new Error("Updated login did not survive native persistence");
		return [];
	} catch (error) {
		// Only this fixed synthetic test can produce diagnostics; the normal app
		// does not import this entry or expose a runtime trigger.
		return [
			`native-storage:${stage}:${error instanceof Error ? error.message.slice(0, 160) : "native failure"}`,
		];
	} finally {
		for (const session of sessions) vault?.destroy(session);
	}
}
