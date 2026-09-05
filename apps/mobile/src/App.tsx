import { useState } from "react";
import { Button, SafeAreaView, Text, TextInput } from "react-native";
import { nativeCrypto } from "./native-crypto";
import { MobileVault } from "./vault";

export default function App() {
	const [password, setPassword] = useState("");
	const [status, setStatus] = useState(
		"Native development build. Independent audit required. Use synthetic credentials only.",
	);
	return (
		<SafeAreaView style={{ padding: 24, gap: 16 }}>
			<Text accessibilityRole="header" style={{ fontSize: 28 }}>
				Sovereignty
			</Text>
			<Text>{status}</Text>
			<TextInput
				accessibilityLabel="Synthetic master password"
				placeholder="Synthetic master password"
				secureTextEntry
				autoCapitalize="none"
				value={password}
				onChangeText={setPassword}
			/>
			<Button
				title="Check native vault creation"
				onPress={() => {
					try {
						const vault = new MobileVault(nativeCrypto());
						const created = vault.create(password);
						vault.destroy(created.session);
						setStatus(
							"Native encryption completed. The temporary vault was cleared.",
						);
					} catch {
						setStatus(
							"Native vault creation failed. A native build and master password are required.",
						);
					} finally {
						setPassword("");
					}
				}}
			/>
		</SafeAreaView>
	);
}
