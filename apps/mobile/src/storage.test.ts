import { protocolVectors } from "@svrgn/protocol-vectors";
import { describe, expect, it, vi } from "vitest";
import { type EncryptedFiles, JournalStore } from "./storage";
import { parseEnvelope } from "./vault";

const envelope = () =>
	parseEnvelope(JSON.stringify(protocolVectors.v1.envelope));
function setup() {
	const data = new Map<string, string>();
	const io: EncryptedFiles = {
		list: () => [...data.keys()],
		size: (name) => data.get(name)?.length ?? 0,
		read: vi.fn(async (name) => {
			const value = data.get(name);
			if (!value) throw new Error("Missing file");
			return value;
		}),
		create: (name, value) => {
			if (data.has(name)) throw new Error("File exists");
			data.set(name, value);
		},
		publish: vi.fn(async (temporary, destination) => {
			if (data.has(destination)) throw new Error("File exists");
			const value = data.get(temporary);
			if (!value) throw new Error("No pending file");
			data.set(destination, value);
			data.delete(temporary);
		}),
	};
	return { data, io, store: new JournalStore(io) };
}
describe("encrypted journal publication", () => {
	it("requires reading existing state and writes only an encrypted envelope", async () => {
		const { store, data } = setup();
		await expect(store.write(envelope())).rejects.toThrow("Read existing");
		expect(await store.load()).toBeNull();
		await store.write(envelope());
		expect([...data.keys()]).toEqual(["vault-000000000001.svrgn"]);
		expect([...data.values()][0]).not.toContain(
			protocolVectors.v1.document.items[0].password,
		);
		expect(await store.load()).toEqual(envelope());
	});
	it("serializes publications and assigns unique final names", async () => {
		const { store, data, io } = setup();
		await store.load();
		let concurrent = 0;
		let peak = 0;
		const publish = io.publish;
		io.publish = async (from, to) => {
			concurrent++;
			peak = Math.max(peak, concurrent);
			await new Promise((resolve) => setTimeout(resolve, 1));
			await publish(from, to);
			concurrent--;
		};
		await Promise.all([
			store.write(envelope()),
			store.write(envelope()),
			store.write(envelope()),
		]);
		expect(peak).toBe(1);
		expect(data.size).toBe(3);
		expect([...data.keys()][2]).toBe("vault-000000000003.svrgn");
	});
	it("ignores an unpublished partial file and preserves the previous committed state", async () => {
		const { store, data, io } = setup();
		await store.load();
		await store.write(envelope());
		io.publish = async () => {
			throw new Error("Interrupted rename");
		};
		await expect(store.write(envelope())).rejects.toThrow();
		expect(data.has("vault-000000000001.svrgn")).toBe(true);
		expect(await new JournalStore(io).load()).toEqual(envelope());
	});
	it("does not silently restore an older document when the latest snapshot is corrupt", async () => {
		const { store, data, io } = setup();
		await store.load();
		await store.write(envelope());
		data.set("vault-000000000002.svrgn", "{}");
		const reopened = new JournalStore(io);
		await expect(reopened.load()).rejects.toThrow();
		await expect(reopened.write(envelope())).rejects.toThrow();
		expect(data.get("vault-000000000002.svrgn")).toBe("{}");
	});
	it("rejects an oversized file before reading its content", async () => {
		const { io, data } = setup();
		data.set("vault-000000000001.svrgn", "synthetic");
		io.size = () => 12 * 1024 * 1024 + 1;
		await expect(new JournalStore(io).load()).rejects.toThrow();
		expect(io.read).not.toHaveBeenCalled();
	});
	it("rejects unexpected plaintext properties in persisted envelopes", () => {
		expect(() =>
			parseEnvelope(
				JSON.stringify({ ...envelope(), password: "synthetic leak" }),
			),
		).toThrow();
		const altered = envelope();
		Object.assign(altered.kdf, { password: "synthetic leak" });
		expect(() => parseEnvelope(JSON.stringify(altered))).toThrow();
	});
	it("fails rather than replacing a concurrently published snapshot", async () => {
		const { store, data } = setup();
		await store.load();
		data.set("vault-000000000001.svrgn", "external existing state");
		await expect(store.write(envelope())).rejects.toThrow();
		expect(data.get("vault-000000000001.svrgn")).toBe(
			"external existing state",
		);
		await expect(store.write(envelope())).rejects.toThrow();
		expect(data.size).toBe(1);
	});
	it("refuses replacing the loaded vault identifier", async () => {
		const { store, data } = setup();
		await store.load();
		await store.write(envelope());
		await expect(
			store.write({ ...envelope(), id: "different-vault" }),
		).rejects.toThrow();
		expect(data.size).toBe(1);
	});
});
