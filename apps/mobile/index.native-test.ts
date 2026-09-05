// CI-only entry: never imported by index.ts or selectable by a runtime URL.
import { registerRootComponent } from "expo";
import { File, Paths } from "expo-file-system";
import { createElement, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { runNativeVectors } from "./src/native-vectors";

function NativeAcceptance() {
	const [status, setStatus] = useState("Running native crypto acceptance");
	useEffect(() => {
		const result = runNativeVectors();
		const file = new File(Paths.document, "native-test-result.json");
		file.write(JSON.stringify(result));
		setStatus(
			`${result.passed ? "PASS" : "FAIL"}: ${result.checks} native checks`,
		);
	}, []);
	return createElement(
		View,
		{ style: { padding: 48 } },
		createElement(Text, null, "Sovereignty native acceptance"),
		createElement(Text, null, status),
	);
}
registerRootComponent(NativeAcceptance);
