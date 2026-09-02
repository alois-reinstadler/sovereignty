const WORDS = [
	"amber",
	"atlas",
	"birch",
	"breeze",
	"cedar",
	"comet",
	"coral",
	"delta",
	"ember",
	"fern",
	"fjord",
	"harbor",
	"indigo",
	"jungle",
	"lumen",
	"maple",
	"meadow",
	"nova",
	"orbit",
	"pebble",
	"quartz",
	"river",
	"saffron",
	"summit",
	"timber",
	"violet",
	"willow",
	"zephyr",
] as const;

function secureIndex(max: number): number {
	if (max <= 0 || max > 256) throw new Error("Invalid random range");
	const limit = Math.floor(256 / max) * max;
	const bytes = new Uint8Array(1);
	do crypto.getRandomValues(bytes);
	while ((bytes[0] ?? 0) >= limit);
	return (bytes[0] ?? 0) % max;
}

export function generatePassphrase(words: number): string {
	return Array.from(
		{ length: words },
		() => WORDS[secureIndex(WORDS.length)],
	).join("-");
}
