import { FormDiscovery } from "../src/forms";

const result = document.getElementById("result");
document.addEventListener("submit", (event) => {
	event.preventDefault();
	if (result)
		result.textContent =
			"Synthetic submission received. No network request made.";
});
document.getElementById("replace")?.addEventListener("click", () => {
	const form = document.getElementById("primary");
	if (form) form.replaceWith(form.cloneNode(true));
});
document.getElementById("disable")?.addEventListener("click", () => {
	document
		.querySelector('#primary input[type="password"]')
		?.setAttribute("readonly", "");
});
// Browser verification exercises the actual module; capture retains only test assertions.
const discovery = new FormDiscovery();
let submissions = 0;
let matchedSyntheticCredentials = false;
Object.assign(window, {
	sovereigntyFixture: {
		discover: () => discovery.discover(document, location.origin),
		watch: (id: string) =>
			discovery.watch(
				id,
				location.origin,
				Date.now() + 30_000,
				(value) => {
					submissions += 1;
					matchedSyntheticCredentials =
						value.username === "synthetic-user" &&
						value.password === "synthetic-password-only";
				},
				() => true,
			),
		captureResult: () => ({ submissions, matchedSyntheticCredentials }),
		cancel: () => discovery.clear(),
		fill: (id: string) =>
			discovery.fill(
				id,
				location.origin,
				"synthetic-user",
				"synthetic-password-only",
			),
	},
});
