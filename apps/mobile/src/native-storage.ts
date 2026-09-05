import { Directory, File, Paths } from "expo-file-system";
import { JournalStore } from "./storage";

export function nativeStore() {
	const directory = new Directory(Paths.document, ".svrgn");
	directory.create({ idempotent: true });
	return new JournalStore({
		list: () => directory.list().map((file) => file.name),
		size: (name) => new File(directory, name).size,
		read: (name) => new File(directory, name).text(),
		create: (name, ciphertext) => {
			const file = new File(directory, name);
			file.create({ overwrite: false });
			file.write(ciphertext);
		},
		publish: (temporary, destination) =>
			new File(directory, temporary).move(new File(directory, destination), {
				overwrite: false,
			}),
	});
}
